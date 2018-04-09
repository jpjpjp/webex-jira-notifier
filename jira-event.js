// jira-event.js
//
// An object for checking if Jira Events are relevant to Spark users who are
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();

// Only allow users for our email organization user the bot
let request = null;
if (process.env.JIRA) {
  // for finding watchers
  request = require('request-promise'),
  auth = 'Basic ' + process.env.JIRA;
} else {
  console.error('Cannot read Jira credential.  Will not notify watchers');
}

//Determine which event we have.  If its one we care about see if it belongs
// to someone in a room with our bot
exports.processJiraEvent = function (jiraEvent, flint, emailOrg, callback=null) {
  //logJiraEvent(jiraEvent);
  try {
    let toNotifyList = [];
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
        ((jiraEvent.issue_event_type_name === 'issue_commented') ||
        (jiraEvent.issue_event_type_name === 'issue_comment_edited'))) {
      toNotifyList = getAllMentions(jiraEvent.comment.body);
      notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
        jiraEvent.comment.author.displayName,
        ' mentioned you in the Jira ', '', '',
        jiraEvent.comment.body, emailOrg, callback);
    } else if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
              (jiraEvent.issue_event_type_name === 'issue_updated') || 
              (jiraEvent.issue_event_type_name === 'issue_work_started') || 
              (jiraEvent.issue_event_type_name === 'issue_assigned')) {
      // Loop through the changed elements to see if one was that assignation
      for (var i = 0, len = jiraEvent.changelog.items.length; i < len; i++) {
        var item = jiraEvent.changelog.items[i];
        if (item.field === 'assignee') {
          // See if the user was assigned to this existing ticket
          toNotifyList.push(item.to);
          notifyPeople(flint, jiraEvent, toNotifyList, jiraEvent.user.displayName, //single user
            ' assigned existing Jira ', ' to you.', 'Description:',
            jiraEvent.issue.fields.description, emailOrg, callback);
        } else if (item.field === 'description') {
          // If data was added TO the description See if the user was mentioned
          if (item.toString) {
            toNotifyList = getAllMentions(item.toString);
            notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
              jiraEvent.user.displayName,
              ' updated the description of Jira ', ' to you.',
              'Description:', item.toString, emailOrg, callback);  
          } else {
            flint.debug('Ignoring delete only update to Description for Jira Event:' + jiraEvent.webhookEvent);
            if (callback) {return(callback(null));}
          } 
        }
      }
    } else if ((jiraEvent.webhookEvent === 'jira:issue_created') &&
          (jiraEvent.issue_event_type_name === 'issue_created')) {
      // This assignee logic is based on a manufactured payload. Should create new test cases when we can
      // Assign users in the create dialog
      if (jiraEvent.issue.fields.assignee) {   
        toNotifyList.push(jiraEvent.issue.fields.assignee);
        notifyPeople(flint, jiraEvent, toNotifyList,  //one name
          jiraEvent.user.displayName,
          ' created a Jira ', ' and assigned it to you.',
          'Description:', jiraEvent.issue.fields.description, 
          emailOrg, callback);
      }
      if (jiraEvent.issue.fields.description) {
        // See if the user was assigned to this existing ticket
        toNotifyList = getAllMentions(jiraEvent.issue.fields.description);
        notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
          jiraEvent.user.displayName,
          ' created a Jira ', ' and mentioned to you in it.',
          'Description:', jiraEvent.issue.fields.description, 
          emailOrg, callback);
      }
    } else if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
      // Someone deleted a ticket that was assigned to the user
      toNotifyList.push(jiraEvent.issue.fields.assignee.name);
      notifyPeople(flint, jiraEvent, toNotifyList,  //one name
        jiraEvent.user.displayName,
        ' deleted a Jira ', ' that was assigned to you.',
        'Description:', jiraEvent.issue.fields.description, 
        emailOrg, callback);
    } else {
      flint.debug('No notifications for Jira Event '+jiraEvent.webhookEvent+
        ':'+jiraEvent.issue_event_type_name+'. Checking for watchers...');
      if (callback) {(callback(null, null));}
      notifyWatchers(flint, jiraEvent, [],  //no one was "notified"
        jiraEvent.user.displayName, callback);
    }
  } catch (e) {
    console.error('Caught Error in JiraEvent Handler:' + e);
    createTestCase(e, jiraEvent);
    if (callback) {return(callback(e));}
  }
};

// Check the event against our users.  If we get a hit, send a spark message
function notifyPeople(flint, jiraEvent, notifyList, author, eventName, action, elementName, elementValue, emailOrg, cb) {
  if (!notifyList.length) {
    flint.debug('No one to notify for Jira Event:' + jiraEvent.webhookEvent +
                '. Will check for watchers...');
    return notifyWatchers(flint, jiraEvent, notifyList, author, cb);
  }
  notifyList.forEach(function(user) {
    let email = user + '@' + emailOrg;
    let bot = flint.bots.find(function(bot) {return(bot.isDirectTo === email);});
    if (bot) {
      let theBot = bot;
      theBot.recall('user_config').then(function(userConfig) {
        if (userConfig.askedExit) {
          return flint.debug('Supressing message to ' + theBot.isDirectTo);
        }
        sendNotification(flint, theBot, jiraEvent, author, eventName, action, elementName, elementValue, cb);
      }).catch(function(err) {
        console.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        console.error(err.message);
        console.error('Erring on the side of notifying them.');
        sendNotification(flint, theBot, jiraEvent, author, eventName, action, elementName, elementValue, cb);
      });
    } else {
      flint.debug('No bot found for potential recipient:' + email);
      if (cb) {return(cb(null, null));}
    }
  });
  notifyWatchers(flint, jiraEvent, notifyList, author, cb);
}

// Check the event against our watchers.  If we get a hit, send a spark message
function notifyWatchers(flint, jiraEvent, notifyList, author, cb) {
  if (!request) {return;}
  try {
    if ((jiraEvent.issue.fields.watches.watchCount) && (jiraEvent.issue.fields.watches.self)) {
      //TODO, process the watcher list
      // Call the watches.self URL to get the list

      // Remove after we parse some data and feel good about all conditions
      let watcherNews = getWatcherNews(jiraEvent);
      flint.debug('Looking for watcher info: '+jiraEvent.issue.fields.watches.self);

      request({
        "method":"GET", 
        "uri": jiraEvent.issue.fields.watches.self,
        //"uri": "https://jira-eng-gpk2.cisco.com/jira/rest/api/2/issue/SPARK-7329/watchers",
        "json": true,
        headers : {
          "Authorization" : auth
        }
      }).then(function(resp) {
        // Uncomment afters seeing some data
        //let watcherNews = null;
        resp.watchers.forEach(function(watcher) {
          let email = watcher.emailAddress;
          if (notifyList.indexOf(watcher.key) > -1) {
            flint.debug("Skipping watcher:"+email+". Already notified");
            return;
          }
          let bot = flint.bots.find(function(bot) {return (bot.isDirectTo === email);});
          if (bot) {
            let theBot = bot;
            theBot.recall('user_config').then(function(userConfig) {
              if (userConfig.askedExit) {
                return flint.debug('Supressing message to ' + theBot.isDirectTo);
              }
              watcherNews = (!watcherNews) ? getWatcherNews(jiraEvent) : watcherNews;
              sendNotification(flint, theBot, jiraEvent, author,
                watcherNews.description, ' that you are watching.', 
                "", watcherNews.change, cb);
            }).catch(function(err) {
              console.error('Unable to get quietMode status for ' + theBot.isDirectTo);
              console.error(err.message);
              console.error('Erring on the side of notifying them.');
              watcherNews = (watcherNews === {}) ? getWatcherNews(jiraEvent) : watcherNews;
              sendNotification(flint, theBot, jiraEvent, author,
                watcherNews.description, ' that you are watching.', 
                '', watcherNews.change, cb);
            });
          } else {
            flint.debug('No bot found for potential recipient:' + email);
          }
        });
      }).catch(function(err) {
        flint.debug('Unable to get any watcher info: '+err.message);
      });
    } else {
      flint.debug('No watchers of this issue to notify');
    }
  } catch (err) {
    console.error('Error processing watchers: '+err.message);
  }
}

// Figure out how to characterize a JiraEvent for the watchers
function getWatcherNews(jiraEvent) {
  let watcherNews = {
    description: '',
    change: ''
  };
  let changedField = '';

  if ((jiraEvent.changelog) && (jiraEvent.changelog.items[0]) && 
        (jiraEvent.changelog.items[0].field)) {
    changedField = jiraEvent.changelog.items[0].field;
  }
  watcherNews.description = ' updated a Jira ';

  if (jiraEvent.webhookEvent === 'jira:issue_updated') {
    if (jiraEvent.issue_event_type_name === 'issue_commented') {
      watcherNews.description = ' commented on a Jira ';
      watcherNews.change = jiraEvent.comment.body;
    } else if (jiraEvent.issue_event_type_name === 'issue_comment_edited') {
      watcherNews.description = ' uppdated a comment on a Jira ';
      watcherNews.change = jiraEvent.comment.body;
    } else if (jiraEvent.issue_event_type_name === 'issue_assigned') {
      watcherNews.description = ' assigned a Jira ';
      watcherNews.change = getNewsFromChangelong(jiraEvent);
    } else if ((jiraEvent.issue_event_type_name === 'issue_generic') || 
               (jiraEvent.issue_event_type_name === 'issue_updated') ||
               (jiraEvent.issue_event_type_name === 'issue_resolved') ||
               (jiraEvent.issue_event_type_name === 'issue_work_started')) {
      watcherNews.change = getNewsFromChangelong(jiraEvent);
      if (changedField == 'assignee') {
        watcherNews.description = ' assigned a Jira ';
      } else if (changedField == 'status') {
        watcherNews.description = ' updated the status of a Jira ';
      } else if (changedField == 'resolution') {
        watcherNews.description = ' updated the resolution field in a Jira ';
      } else if (changedField == 'description') {
        watcherNews.description = ' updated the description of a Jira ';
        watcherNews.changes = jiraEvent.issue.fields.description;
      } else {
        console.log('Using default updated message for eventtype:%s, changedField:%s', jiraEvent.issue_event_type_name, changedField);
        createTestCase(null, jiraEvent, changedField);    
      }
    } else if (jiraEvent.issue_event_type_name === 'issue_updated') {
      watcherNews.change = getNewsFromChangelong(jiraEvent);
      if (changedField == 'assignee') {
        watcherNews.description = ' assigned a Jira ';
      } else if (changedField == 'description') {
        watcherNews.description = ' updated the description of a Jira ';
        watcherNews.changes = jiraEvent.issue.fields.description;
      } else {
        console.log('Using default updated message for eventtype:%s, changedField:%s', jiraEvent.issue_event_type_name, changedField);
        createTestCase(null, jiraEvent, changedField);    
      }
    } else if (jiraEvent.issue_event_type_name === 'issue_reopened') {
      watcherNews.change = getNewsFromChangelong(jiraEvent);
      watcherNews.description = ' reopened a Jira ';
    } else if (jiraEvent.issue_event_type_name === 'issue_moved') {
      watcherNews.change = getNewsFromChangelong(jiraEvent);
      watcherNews.description = ' moved a Jira ';
    } else if (jiraEvent.issue_event_type_name === 'issue_closed') {
      watcherNews.description = ' closed a Jira ';
    } else if (jiraEvent.issue_event_type_name === 'issue_deleted') {
      watcherNews.description = ' deleted a Jira ';
    } else {
      console.log('No watcherNews for %s:%s_%s', jiraEvent.timestamp, jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
      createTestCase(null, jiraEvent);
    }
  } else if ((jiraEvent.webhookEvent === 'jira:issue_created') &&
    (jiraEvent.issue_event_type_name === 'issue_created')) {
    watcherNews.description = ' created a Jira ';
    watcherNews.change = jiraEvent.issue.fields.description;
  } else if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
    watcherNews.description = ' changed a Jira ';
    watcherNews.change = jiraEvent.issue.fields.description;
  } else {
    console.log('No watcherNews for %s:%s_%s', jiraEvent.timestamp, jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
    createTestCase(null, jiraEvent);
  } 
  return watcherNews;
}

function getNewsFromChangelong(jiraEvent) {
  let change = '';
  if ((jiraEvent.changelog.items[0]) && (jiraEvent.changelog.items[0].field)) {
    change = jiraEvent.changelog.items[0].field + ' changed';
  }
  if ((jiraEvent.changelog.items[0]) && (jiraEvent.changelog.items[0].fromString)) {
    change += ' from:"'+jiraEvent.changelog.items[0].fromString+'",';
  }
  if ((jiraEvent.changelog.items[0]) && (jiraEvent.changelog.items[0].toString)) {
    change += ' to:"'+jiraEvent.changelog.items[0].toString+'"';
  }
  return change;
}


// helper function to build a list of all the mentioned users in a description or comment
function getAllMentions(str) {
  let mentionsRegEx = /\[~(\w+)\]/g;
  let mentions = [];
  str.replace(mentionsRegEx, function(match, username) {
    mentions.push(username);
  });
  return mentions;
}

function sendNotification(flint, bot, jiraEvent, author, eventName, action, elementName, elementValue, cb) {
  flint.debug('Sending a notification to '+bot.isDirectTo+' about '+jiraEvent.issue.key);
  bot.say({markdown: '<br>' + author +
    eventName + jiraEvent.issue.fields.issuetype.name +
    ': **' + jiraEvent.issue.fields.summary + '**' + action});
  if ((elementName) || (elementValue)) {
    bot.say({markdown: '> ' + elementName + elementValue});
  }
  bot.say('https://jira-eng-gpk2.cisco.com/jira/browse/' + jiraEvent.issue.key);
  if (cb) {cb(null, bot);}  
}

// Dump the Jira Event to a file to see what the contents are
var fs = require('fs');
function logJiraEvent(jiraEvent) {  // eslint-disable-line no-unused-vars
  fs.writeFile("./JiraEvents/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
    jiraEvent.issue_event_type_name + ".json", JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
      console.error('Error writing jire event to disk:' + err);
    }
  });
}

function createTestCase(e, jiraEvent, changedField='') {
  fs.writeFile("./jira-event-test-cases/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
    jiraEvent.issue_event_type_name  + '-' + changedField + ".error", JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
      console.error('Error writing jira event to disk:' + err);
    }
    if (e) {
      jiraEvent = e.message + '\n'+ jiraEvent;
      fs.appendFile("./jira-event-test-cases/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
        jiraEvent.issue_event_type_name + ".error", JSON.stringify(e, null, 4), (err) => {
        if (err) {
          console.error('Error writing jira event to disk:' + err);
        }
      });
    }
  });
}
