// jira-event.js
//
// An object for checking if Jira Events are relevant to Spark users who are
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

//Determine which event we have.  If its one we care about see if it belongs
// to someone in a room with our bot
exports.processJiraEvent = function (jiraEvent, flint, callback=null) {
  //logJiraEvent(jiraEvent);
  try {
    let toNotifyList = []
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
        ((jiraEvent.issue_event_type_name === 'issue_commented') ||
        (jiraEvent.issue_event_type_name === 'issue_comment_edited'))) {
      toNotifyList = getAllMentions(jiraEvent.comment.body);
      notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
        jiraEvent.comment.author.displayName,
        ' mentioned you in the Jira ', '', '',
        jiraEvent.comment.body, callback);
    } else if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
              (jiraEvent.issue_event_type_name === 'issue_updated') || 
              (jiraEvent.issue_event_type_name === 'issue_assigned')) {
      // Loop through the changed elements to see if one was that assignation
       for (var i = 0, len = jiraEvent.changelog.items.length; i < len; i++) {
        var item = jiraEvent.changelog.items[i];
        if (item.field === 'assignee') {
          // See if the user was assigned to this existing ticket
          toNotifyList.push(item.to);
          notifyPeople(flint, jiraEvent, toNotifyList, jiraEvent.user.displayName, //single user
            ' assigned existing Jira ', ' to you.', 'Description:',
            jiraEvent.issue.fields.description, callback);
        } else if (item.field === 'description') {
          // If data was added TO the description See if the user was mentioned
          if (item.toString) {
            toNotifyList = getAllMentions(item.toString);
            notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
              jiraEvent.user.displayName,
              ' updated the description of Jira ', ' to you.',
              'Description:', item.toString, callback);  
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
          'Description:', jiraEvent.issue.fields.description, callback);
      }
      if (jiraEvent.issue.fields.description) {
        // See if the user was assigned to this existing ticket
        toNotifyList = getAllMentions(jiraEvent.issue.fields.description);
        notifyPeople(flint, jiraEvent, toNotifyList,  // extract mentions
          jiraEvent.user.displayName,
          ' mentioned you in a new Jira ', '',
          'Description:', jiraEvent.issue.fields.description, callback);
      }
    } else if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
      // Someone deleted a ticket that was assigned to the user
      toNotifyList.push(jiraEvent.issue.fields.assignee.name);
      notifyPeople(flint, jiraEvent, toNotifyList,  //one name
        jiraEvent.user.displayName,
        ' deleted a Jira ', ' that was assigned to you.',
        'Description:', jiraEvent.issue.fields.description, callback);
    } else {
      //flint.debug('Ignoring Jira Event %s:%s', jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
      console.log('Ignoring Jira Event %s:%s', jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
      if (callback) {return(callback(null));}
    }
  } catch (e) {
    console.error('Caught Error in JiraEvent Handler:' + e);
    createTestCase(e, jiraEvent);
    if (callback) {return(callback(e));}
  }
};

// Check the event against our users.  If we get a hit, send a spark message
function notifyPeople(flint, jiraEvent, searchValue, author, eventName, action, elementName, elementValue, callback) {
  if (!searchValue.length) {
    if (callback) {return(callback(null, null));}
    return flint.debug('No one to notify for Jira Event:' + jiraEvent.webhookEvent)
  }
  searchValue.forEach(function(user) {
    // Hack for Mike Cervantes, John Dyer,Kris Boone
    // TODO -- make this configurable
    if (user === 'mcervantes') {
      email = 'miccerva@cisco.com';
    } else if (user === 'jdyer') {
      email = 'johndye@cisco.com';
    } else if (user === 'kboone') {
      email = 'krboone@cisco.com';
    } else {
      email = user + '@cisco.com';
    }
    bot = flint.bots.find(function(bot) {return bot.isDirectTo == email});
    if (bot) {
      let theBot = bot;
      theBot.recall('user_config')
      .then(function(userConfig) {
        if (userConfig.askedExit) {
          return flint.debug('Supressing message to ' + theBot.isDirectTo);
        }
        sendNotification(flint, theBot, jiraEvent, author, eventName, action, elementName, elementValue);
        if (callback) {return(callback(null, theBot));}
      })
      .catch(function(err) {
        console.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        console.error(err.message);
        console.error('Erring on the side of notifying them.');
        sendNotification(flint, theBot, jiraEvent, author, eventName, action, elementName, elementValue);
        if (callback) {return(callback(err, theBot));}
      });
    } else {
      if (callback) {return(callback(null, null));}
      //return flint.debug('No potential notification recipients are using the bot:' + searchValue)
      return console.log('No potential notification recipients are using the bot:' + searchValue)
    }
  });
}

// helper function to build a list of all the mentioned users in a description or comment
function getAllMentions(str) {
  let mentionsRegEx = /\[~(\w+)\]/g
  let mentions = []
  str.replace(mentionsRegEx, function(match, username) {
    mentions.push(username)
  })
  return mentions;
}

function sendNotification(flint, bot, jiraEvent, author, eventName, action, elementName, elementValue) {
  //flint.debug('Sending a notification to '+bot.isDirectTo+' about '+jiraEvent.issue.key);
  console.log('Sending a notification to '+bot.isDirectTo+' about '+jiraEvent.issue.key);
  bot.say({markdown: '<br>' + author +
    eventName + jiraEvent.issue.fields.issuetype.name +
    ': **' + jiraEvent.issue.fields.summary + '**' + action});
  bot.say({markdown: '> ' + elementName + elementValue});
  bot.say('https://jira-eng-gpk2.cisco.com/jira/browse/' + jiraEvent.issue.key);
}

// Dump the Jira Event to a file to see what the contents are
var fs = require('fs');
function logJiraEvent(jiraEvent) {
  fs.writeFile("./JiraEvents/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
    jiraEvent.issue_event_type_name + ".json",
    JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
        console.error('Error writing jire event to disk:' + err);
    }
  });
}

function createTestCase(e, jiraEvent) {
  fs.writeFile("./jira-event-test-cases/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
    jiraEvent.issue_event_type_name + ".error",
    JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
        console.error('Error writing jira event to disk:' + err);
    }
    jiraEvent = e.message + '\n'+ jiraEvent;
    fs.appendFile("./jira-event-test-cases/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent + '-' +
      jiraEvent.issue_event_type_name + ".error",
      JSON.stringify(e, null, 4), (err) => {
      if (err) {
          console.error('Error writing jira event to disk:' + err);
      }
    });
  });
}
