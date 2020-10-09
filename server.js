/*
Cisco Spark Bot to notify users when they are mentioned in a
Jira ticket and/or if it is assigned to them.
*/
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();

// Packages for building a bot as an express app
var Framework = require('webex-node-bot-framework');
var express = require('express');
var bodyParser = require('body-parser');
var logger = require('./logger');
var app = express();
app.use(bodyParser.json({limit: '50mb'}));

// Details about this instance of the app
const package_version = require('./package.json').version;
logger.info(`Running app version: ${package_version}`);
logger.info(`Running node version: ${process.version}`);

// Helper class for calling Jira APIs
let jira = {};
try {
  // Create the object for interacting with Jira
  var JiraConnector = require('./jira-connector.js');
  jira = new JiraConnector();
} catch (err) {
  logger.error('Initialization Failure: ' + err.message);
  process.exit(-1);
}

// Check for required config vars for the environment we are running in
var config = {};
// TOKEN environment variable is the Webex Bot token associated with this bot
// PORT is the environment that our express server will listen on
if ((process.env.TOKEN) && (process.env.PORT)) {
  config.token = process.env.TOKEN;
  config.port = process.env.PORT;
  if (process.env.WEBHOOK) {
    // If no webhook url is set we will attempt to get events via websocket
    config.webhookUrl = process.env.WEBHOOK;
  }
  if (process.env.DEFAULT_DOMAIN) {
    // Restrict bot to spaces where all users have known email domains
    // This is REQUIRED to enable the group space notifications module
    config.restrictedToEmailDomains = process.env.DEFAULT_DOMAIN;
  }
} else {
  logger.error('Cannot start server.  Missing required environment variables PORT and TOKEN');
  return;
}

// If configured enable the Group Notifications Module, which allows
// the bot to run in group spaces and notify about transitions and
// new issues that belong to a certain board or filter.
// Note this REQUIRES that the framework config include the
// restrictToEmailDomains parameter to be set, so outside organizations
// cannot access details about your jira 
let groupNotifier = null;
if (process.env.ENABLE_GROUP_NOTIFICATIONS) {
  try {
    // Create the object for interacting with group spaces
    var GroupNotifications = require('./group-notifier/group-notifications.js');
    groupNotifier = new GroupNotifications(jira, logger, config);
  } catch (err) {
    logger.error('Initialization Failure: ' + err.message);
    process.exit(-1);
  }
}

// This object will process webhook events from jira
let jiraEventHandler = {};
try {
  const JiraEventHandler = require("./jira-event.js");
  //  jiraEventHandler = new JiraEventHandler(jira, groupSpaceConfig);
  jiraEventHandler = new JiraEventHandler(jira, groupNotifier);
} catch (err) {
  logger.error('Initialization Failure while creating Jira Event Handler: ' + err.message);
  process.exit(-1);
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
    ' but may be expected in development.  If you meant this, please disregard warnings about ' +
    ' failed calls to bot.recall() and bot.writeMetric()');
}

// Our bot can provide usage and feedback details to an 'admin space'
// This allows someone to keep an eye on our bots usage if ADMIN_EMAIL
// or ADMIN_SPACE_ID are set.  
// If both are set we prefer the group space to the 1-1 space
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
// This data is used in our health check endpoint
if (process.env.BOTNAME) {botName = process.env.BOTNAME;}
if (process.env.BOT_EMAIL) {botEmail = process.env.BOT_EMAIL;}

// Configure an HTTPS proxy if one is specified
if (process.env.HTTPS_PROXY) {config.httpsProxy = process.env.HTTPS_PROXY;}

// This app is built using the Webex Bot framework for node developers
// https://github.com/webex/webex-node-bot-framework
// Initialize the framework object which processes all the events 
// coming from webex and calls any handlers that we register
var framework = new Framework(config);
framework.messageFormat = 'markdown';
logger.info("Starting framework, please wait...");
if (typeof mConfig.mongoUri === 'string') {
  // Initialize our mongo storage driver and the the bot framework.
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

// Wow, that was a lot of setup.   Now we are ready to process events
// From the webex bot framework or from jira

/***
 * Framework event handlers
 */

// This handler is called when the framework has finished initializing
framework.on("initialized", function () {
  logger.info("framework initialized successfully! [Press CTRL-C to quit]");
});

// Called when the framework discovers a space our bot is in.
// At startup, (before the framework is fully initialized), this
// is called when the framework discovers our bot in an existing space.
// If a bot is added to a new space after our app was started, the
// framework processes the membership:created event, creates a
// new bot object and generates this event with the addedById param
// TL;DR we use the addedById param to see if our bot was just added to a space
framework.on('spawn', function (bot, id, addedById) {
  // Do some housekeeping if the bot for our admin space hasn't spawned yet
  if (!adminsBot) {
    tryToInitAdminBot(bot, framework);
  }
  // Only stay in group spaces if the Group Notification module is enabled
  if (bot.isGroup) {
    if (groupNotifier !== null) {
      groupNotifier.onSpawn(bot, addedById);
    } else {
      logger.info(`Leaving Group Space: ${bot.room.title}`);
      bot.say("Hi! Sorry, I only work in one-on-one rooms at the moment.  Goodbye.")
        .finally(() => {
          bot.exit();
          if (adminsBot) {
            adminsBot.say(`${botName} left the group space "${bot.room.title}"`)
              .catch((e) => logger.error(`Failed to update to Admin about a new space our bot left. Error:${e.message}`));
          }
        });
      return;
    }
  }

  if (!addedById) {
    // Framework discovered an existing space with our bot, log it
    if (!framework.initialized) {
      logger.info(`During startup framework spawned bot in existing room: ${bot.room.title}`);
    } else {
      // This case occurs only if maxStartupSpaces was set in framework config
      // We should NOT set this framework configuration object since we want to know
      // about all the spaces that need to be notified based on jira activties
      logger.error(`Bot object spawn() in existing room: "${bot.room.title}" ` +
        `where activity has occured since our server started.   This should nnot happen`);
    }
    // Check if this existing user needs to see a new functionality message
    // Usually this is commented out but I revisit it from time to time
    // bot.recall('newFunctionalityMsg3').then((val) => {
    //   logger.info(`For ${bot.isDirectTo} got newFunctionalityMsg2 == ${val}`);
    // }).catch(() => {
    //   // This user hasn't gotten the new functionality message yet
    //   sayNewFunctionalityMessage(bot);
    // });
  } else {
    logger.info(`Our bot was added to a new room: ${bot.room.title}`);
    if (adminsBot) {
      adminsBot.say(`${botName} was added to a space: ${bot.room.title}`)
        .catch((e) => logger.error(`Failed to update to Admin about a new space our bot is in. Error:${e.message}`));
    }
    if (bot.isDirect) {
      // For group spaces similar logic happens in the groupNotifier.onSpawn()
      postInstructions(bot, /*status_only=*/false, /*instructions_only=*/true);
      bot.store('userEmail', bot.isDirectTo);
    }
  }
});

// Called when our bot is removed from a space or if the membership
// has changed in such a way as to violate membership rules set via
// the restrictedToEmailDomains or guideEmails config parameters
framework.on('despawn', function (bot) {
  if (bot.isGroup) {
    groupNotifier.onDespawn(bot);
  }
});

// Called when a user presses an Action.Submit button on a card
// that our bot posted
framework.on('attachmentAction', async (bot, trigger) => {
  // Check if this is a feedback request which can come from
  // 1-1 and group spaces
  if (trigger.attachmentAction.inputs.action === 'feedback') {
    return processFeedback(bot, trigger);
  }
  if (bot.isDirect) {
    // Currently there are no cards yet in 1-1 spaces.  This logic will change when we add them.
    return logger.error(`Got an unexpected button press event in space with ${bot.isDirectTo}.  Ignoring.`);
  }
  groupNotifier.processAttachmentAction(bot, trigger);
});

/****
## Process incoming messages
   The framework will call the appropriate framework.hears() function
   when the message to the bot matches the expression or text 
****/

var responded = false;
var status_words = /^\/?(status|are you (on|working))( |.|$)/i;
framework.hears(status_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Status Request for ' + bot.room.title);
  postInstructions(bot, /*status_only=*/true);
  responded = true;
});

var no_watcher_words = /^\/?(no watcher)s?( |.|$)/i;
framework.hears(no_watcher_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Disable Watcher Notifications Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  toggleWatcherMsg(bot, false);
  responded = true;
});

var yes_watcher_words = /^\/?(yes watcher)s?( |.|$)/i;
framework.hears(yes_watcher_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Enable Watcher Notifications Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  toggleWatcherMsg(bot, true);
  responded = true;
});

var no_notifyself_words = /^\/?(no notify ?self)( |.|$)/i;
framework.hears(no_notifyself_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Disable Notifications Made by user Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  toggleNotifySelf(bot, false);
  responded = true;
});

var yes_notifyself_words = /^\/?(yes notify ?self)( |.|$)/i;
framework.hears(yes_notifyself_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Enable Notifications Made by user Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  toggleNotifySelf(bot, true);
  responded = true;
});

var exit_words = /^\/?(exit|goodbye|mute|leave|shut( |-)?up)( |.|$)/i;
framework.hears(exit_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Exit Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  setAskedExit(bot, true);
  updateAdmin(bot.isDirectTo + ' asked me to turn off notifications');
  responded = true;
});

var return_words = /^\/?(talk to me|return|un( |-)?mute|come( |-)?back)( |.|$)/i;
framework.hears(return_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Return Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  setAskedExit(bot, false);
  updateAdmin(bot.isDirectTo + ' asked me to start notifying them again');
  responded = true;
});

// This is undocumented at this time (not in any help messages)
// Need to figure out a way to tell users who aren't being 
// notified about changes to jira issues they are watching that their
// jira adminstrator needs to grant access to the jira acocunt 
// associated with this bot
var project_words = /^\/?(projects)( |.|$)/i;
framework.hears(project_words, function (bot/*, trigger*/) {
  logger.verbose('Processing Projects Request for ' + bot.room.title);
  if (bot.isGroup) {return;}
  if (process.env.JIRA_PROJECTS) {
    bot.say(`The projects that I can lookup watchers in are: ` + 
      `${jira.jiraAllowedProjects.join(', ')}\n` +
      `\n\nThe projects that denied permission to my lookup watcher requests since my last restart are: ` +
      `${jira.jiraDisallowedProjects.join(', ')}\n\n` +
      `If you are interested in being notified about tickets in any of these denied projects, ` +
      ` or ones in projects not listed here, please post a message in the ` +
      `[Ask JiraNotification Bot space](https://eurl.io/#Hy4f7zOjG) and we can find ` +
      `an appropriate project admin to help get me access.`);
  } else {
    bot.say('Sorry, I cannot access the list of projects I am allowed to view right now.');
  }
  responded = true;
});

/****
 * Undocumented admin commands to provide stats on how the bot
 * is doing.   Regardless of which space the user typed these
 * commands in the response only goes to the admin space configured
 * via the ADMIN_EMAIL or ADMIN_SPACE_ID environment
****/

// List all the spaces our bot is in
framework.hears('/showadmintheusers', function (bot/*, trigger*/) {
  logger.verbose('Processing /showadmintheusers Request for ' + bot.room.title);
  updateAdmin('The following people are using me:', true);
  responded = true;
});

// List all the projects our bot's jira account seems to have access to
framework.hears('/showadmintheprojects', function (bot/*, trigger*/) {
  logger.verbose('Processing /showadmintheprojects Request for ' + bot.room.title);
  jira.lookupAvailableProjects().then((projects) => {
    updateAdmin(`I can see these projects: ${Array.sort(Array.from(projects, p => p.key)).join(', ')}`);
  }).catch((e) => logger.error(`Failed showing available projects: ${e.message}`));
  responded = true;
});

// List all the projects assoicated with issue where we failed to get the watchers
framework.hears('/showadminnowatchers', function (bot/*, trigger*/) {
  logger.verbose('Processing /showadminbadwatchers Request for ' + bot.room.title);
  // Our jira module keeps track of the projects assoicated with issues where
  // the watcher lookup request failed.  If users complain that they are not
  // being notified about changes to issues they are watching it can be helpful
  // to determine if the problem is due to the jira account assoicated with this
  // bot not having permissions to "see" these projects
  let projects = jira.getDisallowedProjects().join(', ');
  if (projects) {
    adminsBot.say(`I have stopped looking for watchers on the following projects: ${projects}`);
  } else {
    adminsBot.say(`I have been able to lookup watchers for all the events I have received since my last restart.`);
  }
  responded = true;
});

// List all the boards and filters that group spaces are watching
framework.hears('/showadmintheboards', function (bot/*, trigger*/) {
  logger.verbose('Processing /showadmintheboards Request for ' + bot.room.title);
  if (groupNotifier) {
    groupNotifier.showAdminStats();
  } 
  responded = true;
});

// Post a comment on an issue that the bot recently sent a notification
// about if the user sends a thread reply to that notification which starts
// with the word "reply"
var reply_words = /^\/?reply/i;
framework.hears(reply_words, function (bot, trigger) {
  logger.verbose('Processing reply request from ' + bot.room.title);
  if (bot.isGroup) {return;}
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
        bot.reply(trigger.message, 'Sorry, cannot find last notification to reply to. ' +
          'Please click the link above and update directly in jira.');
      }
    }).catch((e) => {
      logger.warn('Failure in reply handler: ' + e.message);
      bot.reply(trigger.message, 'Sorry, cannot find last notification to reply to. ' +
        'Please click the link above and update directly in jira.');
    });
  responded = true;
});

// Best practic is to always support help as a command
framework.hears('help', function (bot/*, trigger*/) {
  postInstructions(bot);
  responded = true;
});

// Best practice is to have some kind of a response to 
// unexpected input
framework.hears(/.*/, function (bot, trigger) {
  if (!responded) {
    if (bot.isGroup) {
      if (trigger.args[0] === botName) {
        trigger.args.shift();
        trigger.text = trigger.args.join(' ');
        return processGroupSpaceCommand(bot, trigger);
      }
    }
    if (trigger.message.parentId) {
      // TODO:  Unless this is a request to delete a notification
      // Handle threaded replies as a request to post a comment
      logger.info(`Posting a comment as a reply in space: "${bot.room.title}"`);
      jira.postCommentToParent(bot, trigger);
    } else {
      let text = trigger.text;
      bot.reply(trigger.message, 'Don\'t know how to respond to "' + text + '"' +
        '.  Enter **help** for info on what I do understand.');
      logger.info('Bot did not know how to respond to: ' + text +
        ', from ' + bot.room.title);
    }
  }
  responded = false;
});

/*
 * Helper methods called by the handlers
 */
async function postInstructions(bot, status_only = false, instructions_only = false) {
  try {
    if (bot.isGroup) {
      logger.verbose('Processing help Request for ' + bot.room.title);
      groupNotifier.groupStatus.postStatusCard(bot);
    } else {
      logger.verbose('Processing help Request for ' + bot.room.title);
      let msg = "I will look for Jira tickets that are assigned to, or that mention " +
      bot.isDirectTo + " and notify you so you can check out the ticket immediately.  " +
      "\n\nIf you'd like to comment on a ticket I notified you about you can post " +
      "a threaded reply and I'll update the ticket with your message as a comment." +
      "\n\nI'll also notify you of changes to any tickets you are watching. " +
      'If the watcher messages make me too "chatty", but you want to ' +
      'keep getting notified for mentions and assignments just type **no watchers**. ' +
      'If you want the watcher messages back, type **yes watchers**.' +
      '\n\nI can only notify watchers for issues in projects that I have been granted access to. ' +
      'To see a list of projects I have access to and learn how to request other projects, ' +
      'type **projects**' +
      '\n\nBy default, I won\'t notify you about changes you have made, but if you want to ' +
      'see them just type **yes notifyself**. ' +
      'If you want to turn that behavior off, type **no notifyself**.' +
      "\n\nYou can also type the command **shut up** to get me to stop sending any messages. " +
      "If you ever want me to start notifying you again, type **come back**." +
      "\n\nIf you aren't sure if I'm giving you notifications, just type **status**";
      if ((process.env.ASK_SPACE_NAME) && (process.env.ASK_SPACE_URL)) {
        msg += `\n\nQuestions or feedback?   [Join the ${process.env.ASK_SPACE_NAME}](${process.env.ASK_SPACE_URL})`;
      }
      if (!status_only) {
        await bot.say(msg);
      }
      if (!instructions_only) {
        let userConfig = await bot.recall('userConfig');
        //.then(function (userConfig) {
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
          msg += '\n\nType **help** to learn how to change your Notification state.\n\n' +
            'Add me to a group space to get notifications about **all** issues related to a jira board or filter.';
        } else {
          msg += '\n\nAdd me to a group space to get notifications about **all** issues related to a jira board or filter.'; 
        }
        await bot.say(msg);
        logger.debug('Status for ' + bot.room.title + ': ' + JSON.stringify(userConfig, null, 2));
      }
    }
  } catch(e) {
    logger.error('Unable to get askedExit status for ' + bot.room.title);
    logger.error(err.message);
    bot.say("Hmmn. I seem to have a database problem, and can't report my notification status.   Please ask again later.");
  }
}

/****
## Helper methods for handling input in 1-1 spaces
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

/*
 * Helper methods for Group Space Commands and Configuration
 */
function processGroupSpaceCommand(bot, trigger) {
  logger.info(`Processing a "${trigger.text}" request in space: "${bot.room.title}"`);
  if (trigger.text.match(/(delete)/i)) {
    let msg = 'I can only process a "delete" command as a threaded reply to a message that I posted';
    if (trigger.message.parentId) {
      bot.webex.messages.remove(trigger.message.parentId)
        .catch(e => {
          logger.info(`Failed to delete a parent message. ` +
            `This is usually because it wasn't posted by the bot.  Error: ${e.message}`);
          bot.reply(trigger.message, msg);
        });
    } else {
      bot.reply(trigger.message, msg);
    }
  // Todo add support for the reply here.
  } else {
    /* WHen in doubt, show the status */
    groupNotifier.groupStatus.postStatusCard(bot);
  }
}

/*
 * Helper methods for the Admin space
 */
function updateAdmin(message, listAll = false) {
  try {
    if (listAll) {
      let directCount = 0;
      let groupCount = 0;
      message += '\n';
      framework.bots.forEach(function (bot) {
        if (bot.isDirect) {
          message += '* Direct: ' + bot.isDirectTo + '\n';
          directCount += 1;
        } else {
          message += '* Group Space: ' + bot.room.title + '\n';
          groupCount += 1;
        }
      });
      message += `\n\nFor a total of ${directCount} users, and ${groupCount} spaces.`;
    }
    adminsBot.say({'markdown': message});
  } catch (e) {
    logger.warn('Unable to spark Admin the news ' + message);
    logger.warn('Reason: ' + e.message);
  }
}

// Post info to the admin space when a user hits the
// "Feedback" button on a card posted by our bot
function processFeedback(bot, trigger) {
  let attachmentAction = trigger.attachmentAction;
  let submitter = trigger.person;

  bot.reply(attachmentAction,
    `Your feedback: "${attachmentAction.inputs.feedback}", has been captured.  A bot administrator may reach out to you for more details.  Thank you!`)
    .catch((e) => this.logger.error(`Failed handling a "Send Feedback: ${e.message}`));

  let msg = 'Feedback sumbitted:\n' +
    `* User: ${submitter.emails[0]} - ${submitter.displayName} \n` +
    `* Space: ${bot.room.title}\n` +
    `* Date: ${attachmentAction.created} \n` +
    `* feedback: ${attachmentAction.inputs.feedback}`;

  if (adminsBot) {
    adminsBot.say('markdown', msg)
      .catch((e) => this.logger.error(`Failed sending feedback: "${msg}" to admin space: ${e.message}`));
  } else {
    logger.error(`Feedback submitted but no admin bot to send it to.`);
    logger.error(msg);
  }
};

// When bots are spawned look for the admin space
function tryToInitAdminBot(bot, framework) {
  // Set our bot's email -- this is used by our health check endpoint
  if (botEmail === 'the bot') {  // should only happen once
    botEmail = bot.person.emails[0];
    botName = bot.person.displayName;
  }
  // See if this is the bot that belongs to our admin space
  if (!adminsBot) {
    if ((bot.isDirect) && (adminEmail) &&
      (bot.isDirectTo.toLocaleLowerCase() === adminEmail.toLocaleLowerCase())) {
      adminsBot = bot;
    } else if ((!adminsBot) && (adminSpaceId) && (bot.room.id === adminSpaceId)) {
      adminsBot = bot;
    }
    if (adminsBot) {
      framework.adminsBot = adminsBot;
      if (groupNotifier !== null) {
        groupNotifier.setFeedbackSpace(adminsBot);
      }
      adminsBot.say('Starting up again...');
    }
  }
}

// This function is handy when we want to notify all users, once,
// about new functionality changes.  It is generally commented out
// until we decide its needed.
// function sayNewFunctionalityMessage(bot) {
//   bot.say('If you find your personal jira notifications in this 1-1 space ' +
//     'with me helpful, your entire team might find my new Transition and ' +
//     'New Issues for Group Spaces functionality useful too.\n\n' +
//     'Just add me to a group space, where ' +
//     'you can configure me to watch jira boards and filters so that I can ' +
//     'provide notifications when new issues are created, or when the status ' +
//     'changes on existing issues that match the configured filter criteria.\n\n' +
//     'Stay on top of your team\'s work by adding me to spaces where bug triage, ' +
//     'scrum work, or feature transition progress is being tracked!');
//   bot.store('newFunctionalityMsg3', true);
// }


/****
## Server config & housekeeping
****/

// Health Check
app.get('/', function (req, res) {
  msg = `I'm alive.  To use this app add ${botEmail} to a Webex Teams space.`;
  if (process.env.DOCKER_BUILD) {
    msg += ` App Version:${package_version}, running in container built ${process.env.DOCKER_BUILD}.`;
  }
  res.send(msg);
});


// Jira webbhook
app.post('/jira', function (req, res) {
  let jiraEvent = {};
  try {
    jiraEvent = req.body;
    if (typeof jiraEvent.webhookEvent !== 'undefined') {
      jiraEventHandler.processJiraEvent(jiraEvent, framework);
    }
  } catch (e) {
    logger.warn('Error processing Jira Event Webhook:' + e);
    logger.warn('Ignoring: ' + JSON.stringify(jiraEvent));
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
  if (adminsBot) {
    adminsBot.say('Shutting down...')
      .finally(() => {
        server.close();
        framework.stop().then(function () {
          process.exit();
        });    
      });
  } else { 
    server.close();
    framework.stop().then(function () {
      process.exit();
    });
  }
}
