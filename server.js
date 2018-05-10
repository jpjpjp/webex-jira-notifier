/*
Cisco Spark Bot to notify users when they are mentioned in a
Jira ticket and/or if it is assigned to them.
*/
/*jshint esversion: 6 */  // Help out our linter

var Flint = require('node-flint');
var webhook = require('node-flint/webhook');
var express = require('express');
var bodyParser = require('body-parser');
var app = express();

// When running locally read environment variables from a .env file
require('dotenv').config();
logger = require('./logger');

// Only allow users for our email organization user the bot
let emailOrg = '';
if (process.env.EMAIL_ORG) {
  emailOrg = process.env.EMAIL_ORG;
} else {
  logger.error('Cannot read required environment variable EMAIL_ORG');
  return;
}


// Set the config vars for the environment we are running in
var config = {};
if ((process.env.WEBHOOK) && (process.env.TOKEN) && (process.env.PORT)) {
  config.webhookUrl = process.env.WEBHOOK;
  config.token = process.env.TOKEN;
  config.port = process.env.PORT;
} else {
  logger.error('Cannot start server.  Missing required environment varialbles WEBHOOK and TOKEN');
  return;
}

// Keep track about "stuff" I learn from the users in a hosted Mongo DB
var mCollection = null;
// TODO: Have a different env for offline mode vs. emulator mode
if (!process.env.SPARK_API_URL) {
  var mongo_client = require('mongodb').MongoClient;
  var mConfig = {};
  if ((process.env.MONGO_USER) && (process.env.MONGO_PW)) {
    mConfig.mongoUser = process.env.MONGO_USER;
    mConfig.mongoPass = process.env.MONGO_PW;
    mConfig.mongoUrl = process.env.MONGO_URL;
    mConfig.mongoDb = process.env.MONGO_DB;
  } else {
    logger.error('Cannot find required environent variables MONGO_USER, MONGO_PW, MONGO_URL, MONGO_DB');
    return;
  }
  var mongo_collection_name ="cjnMongoCollection";
  var mongoUri = 'mongodb://'+mConfig.mongoUser+':'+mConfig.mongoPass+'@'+mConfig.mongoUrl+mConfig.mongoDb+'?ssl=true&replicaSet=Cluster0-shard-0&authSource=admin';

  mongo_client.connect(mongoUri, function(err, db) {
    if (err) {return logger.error('Error connecting to Mongo '+ err.message);}
    db.collection(mongo_collection_name, function(err, collection) {
      if (err) {return logger.error('Error getting Mongo collection  '+ err.message);}
      mCollection = collection;
      mongo_client_ready = true;
      logger.info('Database connection for persistent storage is ready.');
    });
  });
}

// Keep track about "stuff" I learn from the users in a Mongo DB and in the bots memory store
var botUserInfo = {
  _id: null,
  askedExit: false,
  watchersMsgs: true,
  newFunctionalityMsg: false,
  trackTickets: []
};

// The admin will get extra notifications about bot usage
var adminEmail = '';
if (process.env.ADMIN_EMAIL) {
  adminEmail = process.env.ADMIN_EMAIL;
} else {
  logger.error('No ADMIN_EMAIL environment variable.  Will not notify author about bot activity');
}
var adminsBot = null;

//app.use(bodyParser.json());
app.use(bodyParser.json({limit: '50mb'}));


// Helper classes for dealing with Jira Webhook payload
var jiraEventHandler = require("./jira-event.js");

// init flint
var flint = new Flint(config);
flint.start();
flint.messageFormat = 'markdown';
logger.info("Starting flint, please wait...");

flint.on("initialized", function() {
  logger.info("Flint initialized successfully! [Press CTRL-C to quit]");
});


flint.on('spawn', function(bot){
  // An instance of the bot has been added to a room
  logger.verbose('new bot spawned in room: %s', bot.room.id);

  // Say hello to the room
  if(bot.isGroup) {
    bot.say("Hi! Sorry, I only work in one on one rooms at the moment.  Goodbye.");
    bot.exit();
    return;
  } else {
    if (bot.isDirectTo.toLocaleLowerCase() === adminEmail.toLocaleLowerCase()) {
      // Too chatty on Heroku
      // bot.say('**ACTIVE**');
      adminsBot = bot;
      logger.info('Admin:%s is in a space with the Notifier Bot', bot.isDirectTo);
    } else {
      logger.info(bot.isDirectTo + ' is in a space with CiscoJiraNotifier Bot');
    }
    newUser = botUserInfo ;
    if (mCollection) {
      mCollection.findOne({'_id': bot.isDirectTo}, function(err, reply){
        if (err) {return console.log("Can't communicate with db:" + err.message);}
        if (reply !== null) {
          logger.debug('User config exists in DB, so this is an existing room.  Bot has restarted.');
          newUser = reply;
          if (!newUser.hasOwnProperty('newFunctionalityMsg')) {
            sayNewFunctionalityMessage(bot);
            newUser.newFunctionalityMsg = true;
            newUser.watcherMsgs = true;
            mCollection.replaceOne({'_id': bot.isDirectTo}, newUser, {w:1}, function(err) {
              if (err) {return console.log("Can't add new user "+bot.isDirectTo+" to db:" + err.message);}
            });
          }
        } else {
          logger.info("This is a new room.  Storing data about this user");
          newUser._id = bot.isDirectTo;
          mCollection.insert(newUser, {w:1}, function(err) {
            if (err) {return console.log("Can't add new user "+bot.isDirectTo+" to db:" + err.message);}
          });
          postInstructions(bot, /*status_only=*/false, /*instructions_only=*/true);
          updateAdmin(bot.isDirectTo + ' created a space with TropoJiraNotifier Bot');
        }
        // Set the user specific configuration in this just spwaned instance of the  bot
        logger.debug('Setting these user configurations in the bot object');
        logger.debug(newUser);
        bot.store('user_config', newUser);
      });
    } else {
      if (process.env.SPARK_API_URL) {
        // If we are in emulator mode just use memory store
        postInstructions(bot, /*status_only=*/false, /*instructions_only=*/true);
        updateAdmin(bot.isDirectTo + ' created a space with TropoJiraNotifier Bot');
        bot.store('user_config', newUser);
      } else {
        logger.error("Can't access persistent data so many not have correct settings for user " + bot.isDirectTo);
      }
    }
    return;
  }
});

function updateAdmin(message, listAll=false) {
  try {
    adminsBot.say(message);
    if (listAll) {
      let count = 0;
      flint.bots.forEach(function(bot) {
        adminsBot.say({'markdown': "* " + bot.isDirectTo});
        count += 1;
      });
      adminsBot.say(`For a total of ${count} users.`);
    }
  } catch (e) {
    logger.warn('Unable to spark Admin the news ' + message);
    logger.warn('Reason: ' + e.message);
  }
}

function sayNewFunctionalityMessage(bot) {
  bot.say('I\'ve just been updated so that I can give you more information!\n\n'+
    'In addition to notifying you when you are mentioned in, or assigned to, '+
    'a jira ticket, I will now send you a message if a ticket you are watching '+
    'is changed.\n\n'+
    'This may make me too "chatty" for some users, especially those who are '+
    'automatically made watchers to many tickets.   To turn off watcher messages, '+
    'but keep getting notified for mentions and assignments just type **no watchers**\n\n'+
    'If you want the functionality back, type **yes watchers**'+
    "\n\nIf you aren't sure which messages you are getting, just type **status**" +
    "\n\nQuestions or feedback?   Join the Ask JiraNotification Bot space here: https://eurl.io/#Hy4f7zOjG"
  );
}


function postInstructions(bot, status_only=false, instructions_only=false) {
  if (!status_only) {
    bot.say("I will look for Jira tickets that are assigned to, or that mention " +
        bot.isDirectTo + " and notify you so you can check out the ticket immediately.  " +
        "I'll also notify you of changes to any tickets you are watching." +
        '\n\nIf the watcher messages make me too "chatty", but you want to '+
        'keep getting notified for mentions and assignments just type **no watchers**\n\n'+
        '\nIf you want the watcher messages back, type **yes watchers**'+
        "\n\nYou can also type the command **shut up** to get me to stop sending any messages. " +
        "\nIf you ever want me to start notifying you again, type **come back**." +
        "\n\nIf you aren't sure if I'm giving you notifications, just type **status**" +
        "\n\nQuestions or feedback?   Join the Ask JiraNotification Bot space here: https://eurl.io/#Hy4f7zOjG");
  }
  if (!instructions_only) {
    bot.recall('user_config')
      .then(function(userConfig) {
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
        }
        if (status_only) {
          msg += '\n\nType **help** to learn how to change your Notification state.';
        }
        bot.say(msg);
        logger.debug('Status for '+ bot.isDirectTo + ': ' + userConfig);
      })
      .catch(function(err) {
        logger.error('Unable to get askedExit status for ' + bot.isDirectTo);
        logger.error(err.message);
        bot.say("Hmmn. I seem to have a database problem, and can't report my notification status.   Please ask again later.");
      });
  }
}

/****
## Helper methods for per-user notification level control
****/

function setAskedExit(bot, mCollection, exitStatus) {
  bot.recall('user_config')
    .then(function(userConfig) {
      if ((userConfig.askedExit) && (exitStatus === true)) {
        return bot.say('Notifications are already **disabled**.');
      }
      if ((!userConfig.askedExit) && (exitStatus === false)) {
        return bot.say('Notifications are already **enabled**.');
      }
      if (mCollection) {
        mCollection.update({'_id':bot.isDirectTo}, {$set:{'askedExit':exitStatus}}, {w:1}, function(err/*, result*/) {
          if (err) {
            logger.error("Can't communicate with db:" + err.message);
            return bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
          }
          userConfig.askedExit = exitStatus;
          bot.store('user_config', userConfig);
          if (exitStatus === true) {
            bot.say("OK.   I won't give you any more updates.  If you want to turn them on again just type **come back**.");
          } else {
            bot.say("OK.   I'll start giving you updates.  If you want to turn them off again just type **shut up**.");
          }
          postInstructions(bot, /*status_only=*/true);
        });
      } else {
        logger.error('Unable to store exit request for ' + bot.isDirectTo + ' because DB never properly set up.');
        bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
      }
    })
    .catch(function(err) {
      logger.error('Unable to get quietMode status for ' + bot.isDirectTo);
      logger.error(err.message);
      bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
    });
}

function toggleWatcherMsg(bot, mCollection, state) {
  bot.recall('user_config')
    .then(function(userConfig) {
      if (userConfig.askedExit) {
        bot.say('You curently have all notifications turned off.\n\n'+
          'Type **come back** to enable notifications and then you can '+
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
      if (mCollection) {
        mCollection.update({'_id':bot.isDirectTo}, {$set:{'watcherMsgs':state}}, {w:1}, function(err/*, result*/) {
          if (err) {
            logger.error("Can't communicate with db:" + err.message);
            return bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
          }
          userConfig.watcherMsgs = state;
          bot.store('user_config', userConfig);
          if (state === true) {
            bot.say("OK. I will notify you about changes to tickets you are watching.  If you want to turn them off again just type **no watchers**.");
          } else {
            bot.say("OK. I won't notify you about changes to tickets you are watching.  If you want to turn them on again just type **yes watchers**.");
          }
          postInstructions(bot, /*status_only=*/true);
        });
      } else {
        logger.error('Unable to store exit request for ' + bot.isDirectTo + ' because DB never properly set up.');
        bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
      }
    })
    .catch(function(err) {
      logger.error('Unable to get watcherMsgs status for ' + bot.isDirectTo);
      logger.error(err.message);
      bot.say("Hmmn. I seem to have a database problem.   Please ask again later.");
    });
}

/****
## Process incoming messages
****/

/* On mention with command
ex User enters @botname /hello, the bot will write back
*/
var responded = false;
var status_words = /^\/?(status|are you (on|working))( |.|$)/i;
flint.hears(status_words, function(bot/*, trigger*/) {
  logger.verbose('Processing Status Request for ' + bot.isDirectTo);
  postInstructions(bot, /*status_only=*/true);
  responded = true;
});

var no_watcher_words = /^\/?(no watcher)s?( |.|$)/i;
flint.hears(no_watcher_words, function(bot/*, trigger*/) {
  logger.verbose('Processing Disable Watcher Notifications Request for ' + bot.isDirectTo);
  toggleWatcherMsg(bot, mCollection, false); 
  responded = true;
});

var yes_watcher_words = /^\/?(yes watcher)s?( |.|$)/i;
flint.hears(yes_watcher_words, function(bot/*, trigger*/) {
  logger.verbose('Processing Disable Watcher Notifications Request for ' + bot.isDirectTo);
  toggleWatcherMsg(bot, mCollection, true); 
  responded = true;
});

var exit_words = /^\/?(exit|goodbye|mute|leave|shut( |-)?up)( |.|$)/i;
flint.hears(exit_words, function(bot/*, trigger*/) {
  logger.verbose('Processing Exit Request for ' + bot.isDirectTo);
  setAskedExit(bot, mCollection, true);
  updateJp(bot.isDirectTo + ' asked me to turn off notifications');
  responded = true;
});

var return_words = /^\/?(talk to me|return|un( |-)?mute|come( |-)?back)( |.|$)/i;
flint.hears(return_words, function(bot/*, trigger*/) {
  logger.verbose('Processing Return Request for ' + bot.isDirectTo);
  setAskedExit(bot, mCollection, false);
  updateJp(bot.isDirectTo + ' asked me to start notifying them again');
  responded = true;
});

flint.hears('/showadmintheusers', function(bot/*, trigger*/) {
  logger.verbose('Processing /showadmintheusers Request for ' + bot.isDirectTo);
  updateAdmin('The following people are using me:', true);
  responded = true;
});

var help_words = /^\/?help/i;
flint.hears(help_words, function(bot/*, trigger*/) {
  logger.verbose('Processing help Request for ' + bot.isDirectTo);
  postInstructions(bot);
  responded = true;
});

// Dump the trigger details to console for any event
flint.hears(/(^| )jpsNodeBot|.*( |.|$)/i, function(bot, trigger) {
//flint.hears('*', function(bot, trigger) {
  //set bot to listen to incoming webhooks based on @mentions in group rooms
  //or any text in a one on one room

  //@ mention removed before further processing for group conversations. @symbol not passed in message
  let text = trigger.text;
  if (!responded) {
    bot.say('Don\'t know how to respond to "' + text +'"'+
      '.  Enter **help** for info on what I do understand.');
    logger.warn('Bot did not know how to respond to: '+text);
  }
  responded = false;
  logger.verbose("Got a message to my bot:" + text);

  //console.log(trigger);
});

/****
## Server config & housekeeping
****/

// Spark webbhook
app.post('/', webhook(flint));
var server = app.listen(config.port, function () {
  logger.info('Flint listening on port %s', config.port);
});

// Basic liveness test
app.get('/', function (req, res) {
  res.send('I\'m alive');
});

// Jira webbhook
app.post('/jira', function (req, res) {
  let jiraEvent = {};
  try {
    jiraEvent = req.body;
    if (typeof jiraEvent.webhookEvent !== 'undefined') {
      logger.info('Processing incoming Jira Event %s:%s', jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
      jiraEventHandler.processJiraEvent(jiraEvent, flint, emailOrg);
    }
  } catch (e) {
    logger.warn('Error processing Jira Event Webhook:' + e);
    logger.warn('Ignoring: '+ jiraEvent);
    res.status(400);
  }
  res.end();
});


// gracefully shutdown (ctrl-c), etc
process.on('SIGINT', sayGoodbye);
process.on('SIGTERM', sayGoodbye);

function sayGoodbye() {
  /* This is too chatty on heroku which goes up and down all the time by design
   *
  updateJp({'markdown': "It looks like I'm going offline for a bit.   I won't be able to " +
            "notify you about anything until I send you a welcome message again." +
            "\n\nI'm afraid you'll have to use other tools to find out what is happening in Jira. " +
            "You still have an email client, don't you?<br><br>**INACTIVE**"});
    *
    */
  logger.info('stoppping...');
  server.close();
  flint.stop().then(function() {
    process.exit();
  });
}
