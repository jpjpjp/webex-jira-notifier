/*
Cisco Spark Bot to notify users when they are mentioned in a
Jira ticket and/or if it is assigned to them.
*/
/*jshint esversion: 6 */  // Help out our linter
console.log(process.version);


var Framework = require('webex-node-bot-framework');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();
app.use(bodyParser.json({limit: '50mb'}));

// When running locally read environment variables from a .env file
require('dotenv').config();
logger = require('./logger');


// Helper classes for dealing with Jira Webhook payload
var jiraEventHandler = require("./jira-event.js");
let jira = {};
try {
  // Create the object for interacting with Jira
  var JiraConnector = require('./jira-connector.js');
  jira = new JiraConnector();
} catch (err) {
  logger.error('Initialization Failure: ' + err.message);
  process.exit(-1);
}


// EMAIL_ORG environment is the email domain for our jira
// Only those users are allowed to use our bot
let emailOrg = '';
if (process.env.EMAIL_ORG) {
  emailOrg = process.env.EMAIL_ORG;
} else {
  logger.error('Cannot read required environment variable EMAIL_ORG');
  return;
}

// Set the config vars for the environment we are running in
var config = {};
// TOKEN environment variable is the Webex Bot token associated with this bot
// PORT is the enviornment that our express server will listen on
if ((process.env.TOKEN) && (process.env.PORT)) {
  config.token = process.env.TOKEN;
  config.port = process.env.PORT;
  config.maxStartupSpaces = 1000;
  if (process.env.WEBHOOK) {
    // If no webhook url is set we will attempt to get events via websocket
    config.webhookUrl = process.env.WEBHOOK;
  }
} else {
  logger.error('Cannot start server.  Missing required environment variables PORT and TOKEN');
  return;
}

// This bot uses the framework's Mongo persistent storage driver
// Read in the configuration and get it ready to initialize
var mConfig = {};
if (process.env.MONGO_URI) {
  mConfig.mongoUri = process.env.MONGO_URI;
  if (process.env.MONGO_BOT_STORE) {mConfig.storageCollectionName = process.env.MONGO_BOT_STORE;}
  if (process.env.MONGO_BOT_METRICS) {mConfig.metricsCollectionName = process.env.MONGO_BOT_METRICS;}
  if (process.env.MONGO_SINGLE_INSTANCE_MODE) {mConfig.singleInstance = true;}
  // Setup our default persistent config storage
  // That will be assigned to any newly created bots
  config.initBotStorageData = {
    userConfig: {
      askedExit: false,
      watcherMsgs: true,
      notifySelf: false
    },
    newFunctionalityMsg: true, // New users don't need the "new functionality" message
    trackTickets: []
  };
} else {
  console.error('The mongo storage driver requires the following environment variables:\n' +
    '* MONGO_URI -- mongo connection URL see https://docs.mongodb.com/manual/reference/connection-string' +
    '\n\nThe following optional environment variables will also be used if set:\n' +
    '* MONGO_BOT_STORE -- name of collection for bot storage elements (will be created if does not exist).  Will use "webexBotFramworkStorage" if not set\n' +
    '* MONGO_BOT_METRICS -- name of a collection to write bot metrics to (will be created if does not exist). bot.writeMetric() calls will fail if not set\n' +
    '* MONGO_INIT_STORAGE -- stringified object assigned as the default startup config if non exists yet\n' +
    '* MONGO_SINGLE_INSTANCE_MODE -- Optimize lookups speeds when only a single bot server instance is running\n\n' +
    'Also note, the mongodb module v3.4 or higher must be available (this is not included in the framework\'s default dependencies)');
  logger.error('Running without having these set will mean that there will be no persistent storage \n' +
    'across server restarts, and that no metrics will be written.  Generally this is a bad thing for production, \n' +
    ' but may be expected in developement.  If you meant this, please disregard warnings about ' +
    ' failed calls to bot.recall() and bot.writeMetric()');
}

// The admin user or 'admin space' gets extra notifications about bot 
// usage and feedback. This allows someone to keep an eye on our bots
// usage.  If both are set we prefer the group space to the 1-1 space
let adminEmail = '';
let adminSpaceId = '';
let adminsBot = null;
let botName = '';
let botEmail = 'the bot';
if (process.env.ADMIN_SPACE_ID) {
  adminSpaceId = process.env.ADMIN_SPACE_ID;
} else if (process.env.ADMIN_EMAIL) {
  adminEmail = process.env.ADMIN_EMAIL;
} else {
  logger.warn('No ADMIN_SPACE_ID or ADMIN_EMAIL environment variable. \n' +
    'Will not notify anyone about bot activity');
}
// We can use the bot's email and name from environment variables or
// discover them after our first spawn
if (process.env.BOTNAME) {botName = process.env.BOTNAME;}
if (process.env.BOT_EMAIL) {botEmail = process.env.BOT_EMAIL;}

// init the Webex Bot framework for node developers
var framework = new Framework(config);
//framework.start();
framework.messageFormat = 'markdown';
logger.info("Starting framework, please wait...");
if (typeof mConfig.mongoUri === 'string') {
  // Initialize our mongo storage driver and the the bot framework.
  //let MongoStore = require('webex-node=bot-framework/storage/mongo');
  let MongoStore = require('./node_modules/webex-node-bot-framework/storage/mongo.js');
  let mongoStore = new MongoStore(mConfig);
  mongoStore.initialize()
    .then(() => framework.storageDriver(mongoStore))
    .then(() => framework.start())
    .catch((e) => {
      logger.error(`Initialization with mongo storage failed: ${e.message}`);
      process.exit(-1);
    });
} else {
  framework.start()
    .catch((e) => {
      logger.error(`Framework.start() failed: ${e.message}.  Exiting`);
      process.exit(-1);
    });
}


framework.on("initialized", function () {
  logger.info("framework initialized successfully! [Press CTRL-C to quit]");
  if ((adminSpaceId) && (!adminsBot)) {
    // Our admin space was not one of the ones found during initialization
    logger.verbose('Attempting to force spawn of the bot for the Admin space');
    framework.webex.memberships.list({
      roomId: adminSpaceId,
      personId: framework.person.id
    })
      .then((memberships) => {
        if ((memberships.items) && (memberships.items.length)) {
          framework.spawn(memberships.items[0]);
        }
      })
      .catch((e) => logger.error(`Failed trying to force spawn of admin bot: ${e.message}`));
  }
});

// Called when the framework discovers a space our bot is in.
// At startup, (before the framework is fully initialized), this
// is called when the framework discovers an existing spaces.
// After initialization, if our bot is added to a new space the 
// framework processes the membership:created event, creates a
// new bot object and generates this event with the addedById param
// The framework can also "lazily" discover older spaces that it missed
// during startup when any kind of activity occurs there.  In these
// cases addedById will always be null
// TL;DR we use the addedById param to see if this is a new space for our bot
framework.on('spawn', function (bot, id, addedById) {
  // Do some housekeeping if the bot for our admin space hasn't spawned yet
  if (!adminsBot) {
    tryToInitAdminBot(bot, framework);
  }

  if (!addedById) {
    // Framework discovered an existing space with our bot, log it
    if (!framework.initialized) {
      logger.info(`During startup framework spawned bot in existing room: ${bot.room.title}`);
      // An instance of the bot has been added to a room
    } else {
      logger.info(`Bot object spawn() in existing room: "${bot.room.title}" ` +
        `where activity has occured since our server started`);
    }
    // Check if this existing user needs to see the new functionality message
    // bot.recall('newFunctionalityMsg').catch(() => {
    //   // This user hasn't gotten the new functionality message yet
    //   sayNewFunctionalityMessage(bot);
    // });
  } else {
    logger.info(`Our bot was added to a new room: ${bot.room.title}`);
    if (adminsBot) {
      adminsBot.say(`${botName} was added to a space: ${bot.room.title}`)
        .catch((e) => logger.error(`Failed to update to Admin about a new space our bot is in. Error:${e.message}`));
    }
    // By design we leave group spaces we were added to.
    if (bot.isGroup) {
      logger.info(`Leaving Group Space: ${bot.room.title}`);
      bot.say("Hi! Sorry, I only work in one-on-one rooms at the moment.  Goodbye.");
      bot.exit();
      if (adminsBot) {
        adminsBot.say(`${botName} left the group space "${bot.room.title}"`)
          .catch((e) => logger.error(`Failed to update to Admin about a new space our bot left. Error:${e.message}`));
      }
      return;
    }
    postInstructions(bot, /*status_only=*/false, /*instructions_only=*/true);
    bot.store('userEmail', bot.isDirectTo);
  }
});

function sayNewFunctionalityMessage(bot) {
  bot.say('I\'ve just been updated so that I can give you more information!\n\n' +
    'In addition to notifying you when you are mentioned in, or assigned to, ' +
    'a jira ticket, I will now send you a message if a ticket you are watching ' +
    'is changed.\n\n' +
    'This may make me too "chatty" for some users, especially those who are ' +
    'automatically made watchers to many tickets.   To turn off watcher messages, ' +
    'but keep getting notified for mentions and assignments just type **no watchers**\n\n' +
    'If you want the functionality back, type **yes watchers**' +
    "\n\nIf you aren't sure which messages you are getting, just type **status**" +
    "\n\nQuestions or feedback?   Join the Ask JiraNotification Bot space here: https://eurl.io/#Hy4f7zOjG"
  );
}


function postInstructions(bot, status_only = false, instructions_only = false) {
  if (!status_only) {
    bot.say("I will look for Jira tickets that are assigned to, or that mention " +
      bot.isDirectTo + " and notify you so you can check out the ticket immediately.  " +
      "\n\nIf you'd like to comment on a ticket I notified you about you can post " +
      "a threaded reply and I'll update the ticket with your message as a comment." +
      "\n\nI'll also notify you of changes to any tickets you are watching. " +
      'If the watcher messages make me too "chatty", but you want to ' +
      'keep getting notified for mentions and assignments just type **no watchers**. ' +
      'If you want the watcher messages back, type **yes watchers**.' +
      '\n\nBy default, I won\'t notify you about changes you have made, but if you want to ' +
      'see them just type **yes notifyself**. ' +
      'If you want to turn that behavior off, type **no notifyself**.' +
      "\n\nYou can also type the command **shut up** to get me to stop sending any messages. " +
      "If you ever want me to start notifying you again, type **come back**." +
      "\n\nIf you aren't sure if I'm giving you notifications, just type **status**" +
      "\n\nQuestions or feedback?   Join the Ask JiraNotification Bot space here: https://eurl.io/#Hy4f7zOjG");
  }
  if (!instructions_only) {
    bot.recall('userConfig')
      .then(function (userConfig) {
        let msg = '';
        if (userConfig.askedExit) {
          msg = "\n\nCurrent Status: \n* Notifications are **disabled**.";
        } else {
          msg = "\n\nCurrent Status: \n* Mention and Assignment Notifications are **enabled**.";
          if (userConfig.watcherMsgs) {
            msg += "\n* Watched Ticket Changed Notifications are **enabled**.";
          } else {
            msg += "\n* Watched Ticket Changed Notifications are **disabled**.";
          }
          if (userConfig.notifySelf) {
            msg += "\n* Notifications for changes to tickets that you have made are **enabled**.";
          } else {
            msg += "\n* Notifications for changes to tickets that you have made are **disabled**.";
          }
        }
        if (status_only) {
          msg += '\n\nType **help** to learn how to change your Notification state.';
        }
        bot.say(msg);
        logger.debug('Status for ' + bot.isDirectTo + ': ' + JSON.stringify(userConfig, null, 2));
      })
      .catch(function (err) {
        logger.error('Unable to get askedExit status for ' + bot.isDirectTo);
        logger.error(err.message);
        bot.say("Hmmn. I seem to have a database problem, and can't report my notification status.   Please ask again later.");
      });
  }
}

/****
## Helper methods for per-user notification level control
****/

function setAskedExit(bot, exitStatus) {
  bot.recall('userConfig').then((userConfig) => {
    if ((userConfig.askedExit) && (exitStatus === true)) {
      return bot.say('Notifications are already **disabled**.');
    }
    if ((!userConfig.askedExit) && (exitStatus === false)) {
      return bot.say('Notifications are already **enabled**.');
    }
    if (exitStatus === true) {
      bot.say("OK.   I won't give you any more updates.  If you want to turn them on again just type **come back**.");
    } else {
      bot.say("OK.   I'll start giving you updates.  If you want to turn them off again just type **shut up**.");
    }

    userConfig.askedExit = exitStatus;
    bot.store('userConfig', userConfig).then(() => {
      postInstructions(bot, /*status_only=*/true);
    }).catch (function (err) {
      logger.error(`setAskedExit: Unable to store new exit status for ${bot.isDirectTo}: ${err.message}`);
      bot.say("Hmmn. I seem to have a database problem.   You may need to ask again later.");
    });
  }).catch((err) => {
    logger.error(`setAskedExit: Unable to get askedExit state for ${bot.isDirectTo}: ${err.message}`);
    bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
  });

}

function toggleWatcherMsg(bot, state) {
  bot.recall('userConfig').then(function (userConfig) {
    if (userConfig.askedExit) {
      bot.say('You curently have all notifications turned off.\n\n' +
        'Type **come back** to enable notifications and then you can ' +
        'fine tune your watcher notification status.');
      return postInstructions(bot, /*status_only=*/true);
    }
    if ((!userConfig.hasOwnProperty('watcherMsgs')) ||
      (userConfig.watcherMsgs) && (state === true)) {
      bot.say('Watched Ticket Notifications are already enabled.');
      return postInstructions(bot, /*status_only=*/true);
    }
    if ((!userConfig.watcherMsgs) && (state === false)) {
      bot.say('Watched Ticket Notifications are already disabled.');
      return postInstructions(bot, /*status_only=*/true);
    }

    if (state === true) {
      bot.say("OK. I will notify you about changes to tickets you are watching.  If you want to turn them off again just type **no watchers**.");
    } else {
      bot.say("OK. I won't notify you about changes to tickets you are watching.  If you want to turn them on again just type **yes watchers**.");
    }
    userConfig.watcherMsgs = state;
    bot.store('userConfig', userConfig).then(() => {
      postInstructions(bot, /*status_only=*/true);
    }).catch (function (err) {
      logger.error(`toggleWatcherMsg: Unable to watcherMsg=${state} for ${bot.isDirectTo}: ${err.message}`);
      bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
    });
  }).catch(function (err) {
    logger.error(`toggleWatcherMsg: Unable get current watcherMsg state for ${bot.isDirectTo}: ${err.message}`);
    bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
  });
}

function toggleNotifySelf(bot, state) {
  bot.recall('userConfig').then(function (userConfig) {
    if (userConfig.askedExit) {
      bot.say('You curently have all notifications turned off.\n\n' +
        'Type **come back** to enable notifications and then you can ' +
        'fine tune your notification status.');
      return postInstructions(bot, /*status_only=*/true);
    }
    if ((!userConfig.hasOwnProperty('notifySelf') && (state === false)) ||
      (!userConfig.notifySelf) && (state === false)) {
      bot.say('I am not notifying you about changes to Jira tickets made by you.');
      return postInstructions(bot, /*status_only=*/true);
    }
    if ((userConfig.notifySelf) && (state === true)) {
      bot.say('I\'m already notifying you about changes to Jira tickets made by you.');
      return postInstructions(bot, /*status_only=*/true);
    }

    if (state === true) {
      bot.say("OK. I will notify you about changes to tickets made by you.  If you want to turn them off again just type **no notifyself**.");
    } else {
      bot.say("OK. I won't notify you about changes to tickets made by you.  If you want to turn them on again just type **yes notifyself**.");
    }
    userConfig.notifySelf = state;
    bot.store('userConfig', userConfig).then(() => {
      postInstructions(bot, /*status_only=*/true);
    }).catch (function (err) {
      logger.error(`toggleNotifySelf: Unable to set  notifySelf=${state} for ${bot.isDirectTo}: ${err.message}`);
      bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
    });
  }).catch (function (err) {
    logger.error(`toggleNotifySelf: Unable to get current notifySelf state for ${bot.isDirectTo}: ${err.message}`);
    bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
  });
}

function updateAdmin(message, listAll = false) {
  try {
    if (listAll) {
      let count = 0;
      message += '\n';
      framework.bots.forEach(function (bot) {
        message += '* ' + bot.isDirectTo + '\n';
        count += 1;
      });
      message += `\n\nFor a total of ${count} users.`;
    }
    adminsBot.say({'markdown': message});
  } catch (e) {
    logger.warn('Unable to spark Admin the news ' + message);
    logger.warn('Reason: ' + e.message);
  }
}

function tryToInitAdminBot(bot, framework) {
  // Set our bot's email -- this is used by our health check endpoint
  if (botEmail === 'the bot') {  // should only happen once
    botEmail = bot.person.emails[0];
    botName = bot.person.displayName;
  }
  // See if this is the bot that belongs to our admin space
  if ((!adminsBot) && (bot.isDirect) && (adminEmail) &&
    (bot.isDirectTo.toLocaleLowerCase() === adminEmail.toLocaleLowerCase())) {
    adminsBot = bot;
    framework.adminsBot = adminsBot;
  } else if ((!adminsBot) && (adminSpaceId) && (bot.room.id === adminSpaceId)) {
    adminsBot = bot;
    framework.adminsBot = adminsBot;
  }
}




/****
## Process incoming messages
   The framework will call the appropriate framework.hears() function
   when the message to the bot matches the expression or text 
****/

var responded = false;
var status_words = /^\/?(status|are you (on|working))( |.|$)/i;
framework.hears(status_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Status Request for ' + bot.isDirectTo);
  postInstructions(bot, /*status_only=*/true);
  responded = true;
});

var no_watcher_words = /^\/?(no watcher)s?( |.|$)/i;
framework.hears(no_watcher_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Disable Watcher Notifications Request for ' + bot.isDirectTo);
  toggleWatcherMsg(bot, false);
  responded = true;
});

var yes_watcher_words = /^\/?(yes watcher)s?( |.|$)/i;
framework.hears(yes_watcher_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Enable Watcher Notifications Request for ' + bot.isDirectTo);
  toggleWatcherMsg(bot, true);
  responded = true;
});

var no_notifyself_words = /^\/?(no notify ?self)( |.|$)/i;
framework.hears(no_notifyself_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Disable Notifications Made by user Request for ' + bot.isDirectTo);
  toggleNotifySelf(bot, false);
  responded = true;
});

var yes_notifyself_words = /^\/?(yes notify ?self)( |.|$)/i;
framework.hears(yes_notifyself_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Enable Notifications Made by user Request for ' + bot.isDirectTo);
  toggleNotifySelf(bot, true);
  responded = true;
});

var exit_words = /^\/?(exit|goodbye|mute|leave|shut( |-)?up)( |.|$)/i;
framework.hears(exit_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Exit Request for ' + bot.isDirectTo);
  setAskedExit(bot, true);
  updateAdmin(bot.isDirectTo + ' asked me to turn off notifications');
  responded = true;
});

var return_words = /^\/?(talk to me|return|un( |-)?mute|come( |-)?back)( |.|$)/i;
framework.hears(return_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Return Request for ' + bot.isDirectTo);
  setAskedExit(bot, false);
  updateAdmin(bot.isDirectTo + ' asked me to start notifying them again');
  responded = true;
});

framework.hears('/showadmintheusers', function (bot/*, trigger*/) {
  logger.verbose('Processing /showadmintheusers Request for ' + bot.isDirectTo);
  updateAdmin('The following people are using me:', true);
  responded = true;
});

var reply_words = /^\/?reply/i;
framework.hears(reply_words, function (bot, trigger) {
  logger.verbose('Processing reply request from ' + bot.isDirectTo);
  if (trigger.message.parentId) {
    // Handle threaded replies in the catch-all handler
    return;
  }
  bot.recall('lastNotifiedIssue')
    .then((lastNotifiedIssue) => {
      if ((lastNotifiedIssue) && (lastNotifiedIssue.storyUrl)) {
        let comment = trigger.args.slice(1).join(" ");
        jira.addComment(lastNotifiedIssue.storyUrl,
          lastNotifiedIssue.storyKey,
          comment, bot, bot.isDirectTo);
      } else {
        bot.say('Sorry, cannot find last notification to reply to. ' +
          'Please click the link above and update directly in jira.');
      }
    }).catch((e) => {
      logger.warn('Failure in reply handler: ' + e.message);
      bot.say('Sorry, cannot find last notification to reply to. ' +
        'Please click the link above and update directly in jira.');
    });
  responded = true;
});

var help_words = /^\/?help/i;
framework.hears(help_words, function (bot/*, trigger*/) {
  logger.verbose('Processing help Request for ' + bot.isDirectTo);
  postInstructions(bot);
  responded = true;
});

// Respond to unexpected input
framework.hears(/.*/, function (bot, trigger) {
  if (!responded) {
    if (trigger.message.parentId) {
      // Handle threaded replies as a request to post a comment
      jira.postCommentToParent(bot, trigger);
    } else {
      let text = trigger.text;
      bot.say('Don\'t know how to respond to "' + text + '"' +
        '.  Enter **help** for info on what I do understand.');
      logger.info('Bot did not know how to respond to: ' + text +
        ', from ' + bot.isDirectTo);
    }
  }
  responded = false;
});

/****
## Server config & housekeeping
****/

// Health Check
app.get('/', function (req, res) {
  res.send(`I'm alive.  To use this app add ${botEmail} to a Webex Teams space.`);
});

// Jira webbhook
app.post('/jira', function (req, res) {
  let jiraEvent = {};
  try {
    jiraEvent = req.body;
    if (typeof jiraEvent.webhookEvent !== 'undefined') {
      let jiraKey = jiraEvent.issue ? jiraEvent.issue.key : '';
      logger.info('Processing incoming Jira %s Event %s:%s', jiraKey, jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
      jiraEventHandler.processJiraEvent(jiraEvent, framework, emailOrg);
    }
  } catch (e) {
    logger.warn('Error processing Jira Event Webhook:' + e);
    logger.warn('Ignoring: ' + jiraEvent);
    res.status(400);
  }
  res.end();
});

// start express server
var server = app.listen(config.port, function () {
  framework.debug('Framework listening on port %s', config.port);
});

// gracefully shutdown (ctrl-c), etc
process.on('SIGINT', sayGoodbye);
process.on('SIGTERM', sayGoodbye);

function sayGoodbye() {
  logger.info('stoppping...');
  server.close();
  framework.stop().then(function () {
    process.exit();
  });
}
