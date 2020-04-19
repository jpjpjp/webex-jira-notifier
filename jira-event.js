// jira-event.js
//
// An object for checking if Jira Events are relevant to Spark users who are
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();
logger = require('./logger');
let when = require('when');

// Configure Access to Jira to find watcher and other info
let request = null;
let jira_url = '';
let jira_lookup_user_api = '';
let proxy_url = '';
let jira_url_regexp = null;
let jiraProjects = null;
let jiraReqOpts = {
  "json": true,
  headers: {
    'Authorization': 'Basic '
  }
};

// Set up Authorization header
if ((process.env.JIRA_USER) && (process.env.JIRA_PW)) {
  request = require('request-promise');
  jiraReqOpts.headers.Authorization +=
    new Buffer.from(process.env.JIRA_USER + ':' +
      process.env.JIRA_PW).toString('base64');

  if (process.env.JIRA_URL) {
    jira_url = process.env.JIRA_URL;
    // Set variables to get access jira via proxy
    if (process.env.PROXY_URL) {
      jira_url_regexp = new RegExp(jira_url);
      proxy_url = process.env.PROXY_URL;
      logger.info('Will attempt to access Jira at ' + proxy_url +
        'in order in order to proxy requests to ' + jira_url);
    }
  } else {
    console.error(`Missing environment varialbe JIRA_URL.  Messages will not contain links to stories.`);
  }

  // Check if our bot is only allowed to access specified jira projects
  if (process.env.JIRA_PROJECTS) {
    jiraProjects = process.env.JIRA_PROJECTS.split(',');
  }

  // Check if our environment overrode the lookup by username path
  if (process.env.JIRA_LOOKUP_USER_API) {
    jira_lookup_user_api = JIRA_LOOKUP_USER_API; 
  } else {
    jira_lookup_user_api = `${jira_url}/rest/api/2/user`;
  }
} else {
  logger.error('Cannot read Jira credential.  Will not notify watchers');
}

// Set regular expressions to discover the type of events we are getting
const commentEvent = new RegExp(/^comment_/);
const issueEvent = new RegExp(/^jira:issue_/);


//Determine which event we have.  If its one we care about see if it belongs
// to someone in a room with our bot
exports.processJiraEvent = function (jiraEvent, framework, emailOrg, cb = null) {
  //logJiraEvent(jiraEvent);
  try {
    // We'll also notify any watchers of this change 
    //(but only once even if multiple things changed)
    // TODO -- is this needed anymore?
    jiraEvent.watchersNotified = false;

    if (commentEvent.test(jiraEvent.webhookEvent)) {
      logger.info(`Processing incoming Jira comment event: ${jiraEvent.webhookEvent}`);
      return processCommentEvent(jiraEvent, framework, emailOrg, cb);
    } else if (issueEvent.test(jiraEvent.webhookEvent)) {
      logger.info(`Processing incoming Jira issue event: "${jiraEvent.issue_event_type_name}", Issue Key: "${jiraEvent.issue.key}"`);
      return processIssueEvent(jiraEvent, framework, emailOrg, cb);
    } else {
      logger.warn(`Ignoring unknown webhookEvent: "${jiraEvent.webhookEvent}`);
      return;
    }
  } catch (e) {
    logger.error(`processJiraEvent() got exception: ${e.message}`);
  }
};

function processIssueEvent(jiraEvent, framework, emailOrg, cb) {
  try {
    let msgElements = {};
    let event = jiraEvent.issue_event_type_name.substr("issue_".length,
      jiraEvent.webhookEvent.length);
    let user = jiraEvent.user;
    let issue = jiraEvent.issue;

    // // Is this from one of the proejcts we can access?
    // // jiraEvent.ourProjectIdx == -1 means no.
    // const key = jiraEvent.issue.key;
    // // Debug a particiular story
    // // if (key == 'SPARK-7329') {
    // //   console.log('Found the one I want to debug.');
    // // }
    // if (jiraProjects) {
    //   // Ensure this event is associated with one of our allowd projects
    //   // If not, we can notify mentioned users, but not watchers or owners
    //   jiraEvent.ourProjectIdx = jiraProjects.indexOf(key.substr(0, key.indexOf('-')));
    //   if (jiraEvent.ourProjectIdx == -1) {
    //     logger.verbose('Got a webhook for ' + key +
    //       '. Not in our list of projects: ' + process.env.JIRA_PROJECTS);
    //   }
    // }

    // See if there are watchers for this issue and fetch them while we look for mentions
    let watcherPromise = null;
    let watches = issue.fields.watches;
    if (watches && watches.watchCount && watches.self) {
      watcherPromise = request.get(watches.self, jiraReqOpts);
    }

    // While waiting for that, scan the description for mentions...
    toNotifyList = getAllMentions(issue.fields.description);
    // And start building the Bot notification message elements
    msgElements = {
      author: user.displayName,
      authorEmail: user.emailAddress,
      issueKey: issue.key,
      issueType: issue.fields.issuetype.name,
      issueSummary: jiraEvent.issue.fields.summary,
      subject: "issue",
      action: event,
      body: convertNewlines(issue.fields.description),
      issueSelf: issue.self
    };
    // Handle some more complex events
    if ((event === 'created') && (issue.fields.assignee)) {
      // Discover assigned to when issue was assigned when it was created
      msgElements.action = 'assigned';
      msgElements.assignedTo = issue.fields.assignee.name;
      msgElements.assignedToUser = msgElements.assignedTo;
      if (!toNotifyList.find((user) => user === msgElements.assignedToUser)) {
        toNotifyList.push(msgElements.assignedToUser);
      }
    } else if (event === 'assigned') {
      if (jiraEvent.changelog && jiraEvent.changelog.items) {
        msgElements.assignedTo = jiraEvent.changelog.items[0].toString;
        msgElements.assignedToUser = jiraEvent.changelog.items[0].to;
        if (!toNotifyList.find((user) => user === msgElements.assignedToUser)) {
          toNotifyList.push(msgElements.assignedToUser);
        }
      }
    } else if (event === 'generic') {
      // Discover the generic event from the changelog
      if (jiraEvent.changelog && jiraEvent.changelog.items) {
        msgElements.action = jiraEvent.changelog.items[0].field;
        msgElements.updatedTo = jiraEvent.changelog.items[0].toString;
      }
    }
    // msgElements.issueSummary = convertNewlines(issue.fields.summary),
    notifyMentioned(framework, msgElements, toNotifyList, emailOrg, cb);

    // Wait for the watchers (if any)
    if (!watcherPromise) {
      return;
    }
    return when(watcherPromise).then((watcherObj) => {
      if (watcherObj) {
        watchers = watcherObj.watchers;
        watcherEmails = [];
        for (let i = 0; i < watchers.length; i++) {
          if (!toNotifyList.find((user) => user === watchers[i].name)) {
            watcherEmails.push(watchers[i].emailAddress);
          }
        }
        return when(notifyWatchers(framework, msgElements, watcherEmails, emailOrg, cb));
      } else {
        return when(true);
      }
    }).catch((e) => {
      logger.error(`Failed getting watchers associated with issue ${jiraEvent.issue.key}: ` +
        `"${e.message}". Can only notify people mentioned in the description.`);
      // TODO figure out how/if to call notifyPeople in this case
      return notifyPeople(framework, issue, toNotifyList,
        jiraEvent.comment.author.displayName,
        ' mentioned you in a Jira comment for issue ', '', '',
        jiraEvent.comment.body, emailOrg, cb);
    });
  } catch (e) {
    logger.error('Caught Error in JiraEvent Issue Handler:' + e);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

function oldProcessIssueEvent(jiraEvent, framework, emailOrg, cb) {
  try {
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
      (((jiraEvent.issue_event_type_name === 'issue_commented') ||
        (jiraEvent.issue_event_type_name === 'issue_comment_edited')) ||
        ((jiraEvent.issue_event_type_name === 'issue_updated') &&
          (typeof jiraEvent.comment === 'object')))) {
      toNotifyList = getAllMentions(jiraEvent.comment.body);
      notifyPeople(framework, jiraEvent, toNotifyList,  // extract mentions
        jiraEvent.comment.author.displayName,
        ' mentioned you in the Jira ', '', '',
        jiraEvent.comment.body, emailOrg, cb);
    } else if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
      (jiraEvent.issue_event_type_name === 'issue_updated') ||
      (jiraEvent.issue_event_type_name === 'issue_work_started') ||
      (jiraEvent.issue_event_type_name === 'issue_assigned')) {
      // Loop through the changed elements to see if one was that assignation
      if ((!jiraEvent.changelog) || (!jiraEvent.changelog.items.length)) {
        logger.error('Expected a changelog for %s:%s but did not find one!' +
          ' No one will be notified', jiraEvent.webhookEvent,
          jiraEvent.issue_event_type_name);
        createTestCase(null, jiraEvent, 'no-changelog');
        if (cb) {cb(e);}
        return;
      }
      for (var i = 0, len = jiraEvent.changelog.items.length; i < len; i++) {
        var item = jiraEvent.changelog.items[i];
        logger.debug('Looking at changlong issue:', i);
        if (item.field === 'assignee') {
          // See if the user was assigned to this existing ticket
          toNotifyList.push(item.to);
          notifyPeople(framework, jiraEvent, toNotifyList, jiraEvent.user.displayName, //single user
            ' assigned existing Jira ', ' to you.', 'Description:',
            jiraEvent.issue.fields.description, emailOrg, cb);
        } else if (item.field === 'description') {
          // If data was added TO the description see if there are any mentions
          if (item.toString) {
            toNotifyList = getAllMentions(item.toString);
            if (toNotifyList.length) {
              notifyPeople(framework, jiraEvent, toNotifyList,  // extract mentions
                jiraEvent.user.displayName,
                ' updated the description of Jira ', ' to you.',
                'Description:', item.toString, emailOrg, cb);
            } else {
              if (cb) {cb(null);}
              return notifyWatchers(framework, jiraEvent, toNotifyList, jiraEvent.user.displayName, cb);
            }
          } else {
            logger.debug('Ignoring delete only update to Description for Jira Event:' + jiraEvent.webhookEvent);
            if (cb) {cb(null);}
            return notifyWatchers(framework, jiraEvent, toNotifyList, jiraEvent.user.displayName, cb);
          }
        } else {
          logger.debug('No assignees or mentionees to notify for a change to %s, ' +
            'will look for watchers.', item.field);
          if (cb) {cb(null);}
          return notifyWatchers(framework, jiraEvent, toNotifyList, jiraEvent.user.displayName, cb);
        }
      }
    } else if ((jiraEvent.webhookEvent === 'jira:issue_created') &&
      (jiraEvent.issue_event_type_name === 'issue_created')) {
      // This assignee logic is based on a manufactured payload. Should create new test cases when we can
      // Assign users in the create dialog
      if (jiraEvent.issue.fields.assignee) {
        // Jira webhook payload seems to populate assignee differently on different projects...
        if (jiraEvent.issue.fields.assignee.name) {
          toNotifyList.push(jiraEvent.issue.fields.assignee.name);
        } else {
          toNotifyList.push(jiraEvent.issue.fields.assignee);
        }
        notifyPeople(framework, jiraEvent, toNotifyList,  //one name
          jiraEvent.user.displayName,
          ' created a Jira ', ' and assigned it to you.',
          'Description:', jiraEvent.issue.fields.description,
          emailOrg, cb);
      }
      if (jiraEvent.issue.fields.description) {
        // See if the user was assigned to this existing ticket
        toNotifyList = getAllMentions(jiraEvent.issue.fields.description);
        notifyPeople(framework, jiraEvent, toNotifyList,  // extract mentions
          jiraEvent.user.displayName,
          ' created a Jira ', ' and mentioned to you in it.',
          'Description:', jiraEvent.issue.fields.description,
          emailOrg, cb);
      }
    } else if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
      if (!jiraEvent.issue.fields.assignee.name) {
        logger.error('Got an issue deleted with no assignee');
        e = new Error('DeletedWithNoAssignee');
        createTestCase(e, jiraEvent, 'no-assignee');
        notifyWatchers(framework, jiraEvent, [],  //no one was "notified"
          jiraEvent.user.displayName, cb);
        if (cb) {(cb(e));}
        return;
      }
      // Someone deleted a ticket that was assigned to the user
      toNotifyList.push(jiraEvent.issue.fields.assignee.name);
      notifyPeople(framework, jiraEvent, toNotifyList,  //one name
        jiraEvent.user.displayName,
        ' deleted a Jira ', ' that was assigned to you.',
        'Description:', jiraEvent.issue.fields.description,
        emailOrg, cb);
    } else {
      logger.debug('No notifications for Jira Event ' + jiraEvent.webhookEvent +
        ':' + jiraEvent.issue_event_type_name + '. Checking for watchers...');
      if (cb) {(cb(null, null));}
      notifyWatchers(framework, jiraEvent, [],  //no one was "notified"
        jiraEvent.user.displayName, cb);
    }
  } catch (e) {
    logger.error('Caught Error in JiraEvent Handler:' + e);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

function processCommentEvent(jiraEvent, framework, emailOrg, cb) {
  try {
    let toNotifyList = [];
    let msgElements = {};
    // Try to fetch the issue this comment is associated with
    let issuePromise = null;
    let event = jiraEvent.webhookEvent.substr("comment_".length,
      jiraEvent.webhookEvent.length);
    let commentUrl = jiraEvent.comment.self;
    let commentIndex = commentUrl.indexOf('/comment');
    if (commentIndex > 0) {
      let issueUrl = commentUrl.substr(0, commentIndex);
      issuePromise = request.get(issueUrl, jiraReqOpts);
    } else {
      issuePromise = Promise.reject(new Error('Could not find issue link in comment webhook payload'));
    }
    // While waiting for that, scan comment for mentions...
    toNotifyList = getAllMentions(jiraEvent.comment.body);
    // And start building the Bot notification message elements
    msgElements = {
      author: jiraEvent.comment.author.displayName,
      authorEmail: jiraEvent.comment.author.emailAddress,
      subject: "comment",
      action: event,
      body: convertNewlines(jiraEvent.comment.body)
    };
    return when(issuePromise).then((issue) => {
      // See if there are watchers for this issue
      let watcherPromise = null;
      let watches = issue.fields.watches;
      if (watches && watches.watchCount && watches.self) {
        watcherPromise = request.get(watches.self, jiraReqOpts);
      }

      // Add to mgs elements with issue details
      msgElements.issueType = issue.fields.issuetype.name;
      msgElements.issueSummary = convertNewlines(issue.fields.summary),
        msgElements.issueKey = issue.key;
      msgElements.issueSelf = issue.self;
      notifyMentioned(framework, msgElements, toNotifyList, emailOrg, cb);

      // Wait for the watchers (if any)
      if (watcherPromise) {
        return when(watcherPromise);
      } else {
        return when(null);
      }
    }).then((watcherObj) => {
      if (watcherObj) {
        watchers = watcherObj.watchers;
        watcherEmails = [];
        for (let i = 0; i < watchers.length; i++) {
          if (!toNotifyList.find((user) => user === watchers[i].name)) {
            watcherEmails.push(watchers[i].emailAddress);
          }
        }
        return when(notifyWatchers(framework, msgElements, watcherEmails, emailOrg, cb));
      } else {
        return when(true);
      }
    }).catch((e) => {
      logger.error(`Failed getting issue or watchers associated with ${commentUrl}: ` +
        `"${e.message}". Can only notify people mentioned in the comment.`);
      // TODO figure out how to call notifyPeople in this case
      return notifyPeople(framework, issue, toNotifyList,
        jiraEvent.comment.author.displayName,
        ' mentioned you in a Jira comment for issue ', '', '',
        jiraEvent.comment.body, emailOrg, cb);
    });
  } catch (e) {
    logger.error('Caught Error in JiraEvent Comment Handler:' + e);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

async function notifyMentioned(framework, msgElements, notifyList, emailOrg, cb) {
  if (!notifyList.length) {
    logger.verbose('No mentioned users to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return when();
  }
  let mentionedUserPromises = [];
  for (let i=0; i<notifyList.length; i++) {
    url = `${jira_lookup_user_api}?username=${notifyList[i]}`;
    mentionedUserPromises.push(request(url, jiraReqOpts));
  }
  msgElements.recipientType = "mentioned";
  let mentionedEmails = [];
  return when.all(mentionedUserPromises).then((users) => {
    for (let i=0; i<users.length; i++) {
      mentionedEmails.push(users[i].emailAddress);
      if ((msgElements.assignedToUser) && (msgElements.assignedToUser === users[i].name)) {
        msgElements.assignedTo = users[i].displayName;
        msgElements.assignedToEmail = users[i].emailAddress;
      }
    }
    return notifyBotUsers(framework, msgElements, mentionedEmails, emailOrg, cb);
  }).catch((e) => {
    logger.error(`notifyMentioned() caught exception: ${e.message}`);
    return when();
  });
}

function notifyWatchers(framework, msgElements, watchers, emailOrg, cb) {
  if (!watchers.length) {
    logger.verbose('No watchers to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return;
  }
  msgElements.recipientType = "watcher";
  notifyBotUsers(framework, msgElements, watchers, emailOrg, cb);
}

function notifyBotUsers(framework, msgElements, emails, emailOrg, cb) {
  emails.forEach((email) => {
    //let email = user + '@' + emailOrg;
    let bot = framework.bots.find(function (bot) {return (bot.isDirectTo === email);});
    if (bot) {
      let theBot = bot;
      theBot.recall('userConfig').then(function (userConfig) {
        if (userConfig.askedExit) {
          return logger.info('Supressing message to ' + theBot.isDirectTo);
        }
        sendWebexNotification(theBot, userConfig, msgElements, cb);
        // TODO - Try to remember what this was for...
        // Add instrumentation to find users who are not working in the SPARK or TROPO projects
        // if (jiraEvent.ourProjectIdx == -1) {
        //   logger.error(email + ' is working on project ' + jiraEvent.issue.key);
        // }
      }).catch(function (err) {
        logger.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        logger.error(err.message);
        logger.error('Erring on the side of notifying them.');
        sendWebexNotification(theBot, userConfig, msgElements, cb);
      });
    } else {
      logger.verbose('No bot found for potential recipient:' + email);
      // Test framework wants to know if a user who was mentioned or assigned does NOT get a message
      if (cb) {return (cb(null, null));}
    }
  });
}

function sendWebexNotification(bot, userConfig, msgElements, cb) {
  if ((bot.isDirectTo == msgElements.authorEmail) &&
    ((!userConfig) || (!userConfig.hasOwnProperty('notifySelf')) || (!userConfig.notifySelf))) {
    logger.info('Not sending notification of update made by ' + bot.isDirectTo + ' to ' + msgElements.authorEmai);
    return;
  }
  let msg;
  switch (msgElements.recipientType) {
    case ('mentioned'):
      msg = buildMentionedMessage(msgElements, bot.isDirectTo);
      break;
    case ('watcher'):
      msg = buildWatchedMessage(msgElements);
      break;
    default:
      logger.error(`Cannot build message for unknown recipeient ` +
        `type: ${msgElements.recipientType}`);
      return;
  }
  logger.info('Sending a notification to ' + bot.isDirectTo + ' about ' + msgElements.issueKey);
  bot.say({markdown: msg});
  // Store the key of the last notification in case the user wants to reply
  let lastNotifiedIssue = {
    storyUrl: msgElements.issueSelf,
    storyKey: msgElements.issueKey
  };
  bot.store('lastNotifiedIssue', lastNotifiedIssue);
  if (cb) {cb(null, bot);}
}

function buildMentionedMessage(msgElements, botEmail) {
  try {
    let msg = ``;
    switch (msgElements.subject) {
      case ('comment'):
        msg += `You were mentioned in a comment `;
        if (msgElements.action === 'created') {
          msg += `created by ${msgElements.author} on a `;
        } else if (msgElements.action === 'updated') {
          msg += `updated by ${msgElements.author} on a `;
        } else {
          logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
        msg += `Jira ${msgElements.issueType}: **${msgElements.issueSummary}**.` +
          `\n\n${msgElements.body}\n\n`;
        break;

      case ('issue'):
        msg += `You were mentioned in the description of a Jira ${msgElements.issueType} `;
        if (msgElements.action === 'assigned') {
          if (msgElements.assignedToEmail === botEmail) {
            msg = `You were assigned to a Jira ${msgElements.issueType} by ${msgElements.author}: `;
          } else {
            msg = `${msgElements.author} assigned ${msgElements.assignedTo} to a Jira ${msgElements.issueType} you are mentioned in: `;
          }
        } else if (msgElements.action === 'created') {
          msg += `created by ${msgElements.author}: `;
        } else if (msgElements.action === 'status') {
          msg = `${msgElements.author} changed the status to "${msgElements.updatedTo}" for Jira ${msgElements.issueType}: `;
        } else if (msgElements.action === 'updated') {
          msg += `updated by ${msgElements.author}: `;
        } else {
          logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
        msg += `**${msgElements.issueSummary}**.\n\n${msgElements.body}\n\n`;
        break;

      default:
        logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
          `subject:${msgElements.subject} in ${JSON.stringify(msgElements, 2, 2)}`);
    }
    msg += `${jira_url}/browse/${msgElements.issueKey}`;
    return msg;
  } catch (e) {
    throw new Error(`buildWatchedMessage failed: ${e.message}`);
  }
}

function buildWatchedMessage(msgElements) {
  try {
    let msg = `${msgElements.author} `;
    switch (msgElements.subject) {
      case ('comment'):
        if (msgElements.action === 'created') {
          msg += 'commented on a ';
        } else if (msgElements.action === 'updated') {
          msg += 'updated a comment on a ';
        } else {
          logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
        break;

      default:
        logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
          `subject:${msgElements.subject} in ${JSON.stringify(msgElements, 2, 2)}`);
    }
    msg += `Jira ${msgElements.issueType}: **${msgElements.issueSummary}**` +
      ` that you are watching.\n\n${msgElements.body}\n\n`;
    msg += `${jira_url}/browse/${msgElements.issueKey}`;
    return msg;
  } catch (e) {
    throw new Error(`buildWatchedMessage failed: ${e.message}`);
  }
}

function convertNewlines(text) {
  return text.replace(/(?:\r\n\r\n|\r\n|\r|\n)/g, '<br />');
}

// Check the event against our users.  If we get a hit, send a spark message
function notifyPeople(framework, jiraEvent, notifyList, author, eventName, action, elementName, elementValue, emailOrg, cb) {
  // if (!notifyList.length) {
  //   if (!jiraEvent.watchersNotified) {
  //     logger.verbose('No one to notify for Jira Event:' + jiraEvent.webhookEvent +
  //                 '. Will check for watchers...');
  //     return notifyWatchers(framework, jiraEvent, notifyList, author, cb);
  //   } else {
  //     return;
  //   }
  // }
  notifyList.forEach(function (user) {
    let email = user + '@' + emailOrg;
    let bot = framework.bots.find(function (bot) {return (bot.isDirectTo === email);});
    if (bot) {
      let theBot = bot;
      theBot.recall('userConfig').then(function (userConfig) {
        if (userConfig.askedExit) {
          return logger.info('Supressing message to ' + theBot.isDirectTo);
        }
        sendNotification(framework, theBot, jiraEvent, author, eventName, action, elementName, elementValue, userConfig, cb);
        // Add instrumentation to find users who are not working in the SPARK or TROPO projects
        if (jiraEvent.ourProjectIdx == -1) {
          logger.error(email + ' is working on project ' + jiraEvent.issue.key);
        }
      }).catch(function (err) {
        logger.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        logger.error(err.message);
        logger.error('Erring on the side of notifying them.');
        sendNotification(framework, theBot, jiraEvent, author, eventName, action, elementName, elementValue, null, cb);
      });
    } else {
      logger.verbose('No bot found for potential recipient:' + email);
      // Test framework wants to no if a user who was mentioned or assigned does NOT get a message
      if (cb) {return (cb(null, null));}
    }
  });
  notifyWatchers(framework, jiraEvent, notifyList, author, cb);
}

// Check the event against our watchers.  If we get a hit, send a spark message
function oldnotifyWatchers(framework, jiraEvent, notifyList, author, cb) {
  if ((!request) || (process.env.SKIP_WATCHERS)) {return;}
  try {
    let jiraKey = jiraEvent.issue ? jiraEvent.issue.key : '';
    if (jiraEvent.watchersNotified) {
      return logger.debug('Already notified potential watchers for %s event %s:%s',
        jiraKey, jiraEvent.issue_event_type_name, jiraEvent.issue_event_type_name);
    }
    if (jiraEvent.ourProjectIdx == -1) {
      return logger.debug('Don\'t have permission to check watchers for %s',
        jiraKey);
    }

    jiraEvent.watchersNotified = true;
    if ((jiraEvent.fields.watches.watchCount) && (jiraEvent.fields.watches.self)) {
      //TODO, process the watcher list
      // Call the watches.self URL to get the list

      // Remove after we parse some data and feel good about all conditions
      let watcherNews = getWatcherNews(jiraEvent);
      let watcherUrl = jiraEvent.fields.watches.self;

      // Use a proxy server if configured
      if (jira_url_regexp) {
        watcherUrl = watcherUrl.replace(jira_url_regexp, proxy_url);
      }
      logger.debug('Looking for watcher info: ' + watcherUrl);
      logger.debug('Will send ' + watcherNews.description + ', changes:' + watcherNews.change);

      request.get(watcherUrl, jiraReqOpts).then(function (resp) {
        if (!resp.hasOwnProperty('watchers')) {
          throw new Error('Did not get expected response from Jira watcher lookup.  This usually happens due to login failure and redirection.');
        }
        resp.watchers.forEach(function (watcher) {
          let email = watcher.emailAddress;
          if (notifyList.indexOf(watcher.key) > -1) {
            logger.verbose("Skipping watcher:" + email + ". Already notified");
            return;
          }
          let bot = framework.bots.find(function (bot) {return (bot.isDirectTo === email);});
          if (bot) {
            let theBot = bot;
            theBot.recall('userConfig').then(function (userConfig) {
              if ((userConfig.askedExit) || (userConfig.watcherMsgs === false)) {
                return logger.verbose('Supressing message to ' + theBot.isDirectTo);
              }
              watcherNews = (!watcherNews) ? getWatcherNews(jiraEvent) : watcherNews;
              sendNotification(framework, theBot, jiraEvent, author,
                watcherNews.description, ' that you are watching.',
                "", watcherNews.change, userConfig, cb);
            }).catch(function (err) {
              logger.error('Unable to get quietMode status for ' + theBot.isDirectTo);
              logger.error(err.message);
              logger.error('Erring on the side of notifying them.');
              watcherNews = (watcherNews === {}) ? getWatcherNews(jiraEvent) : watcherNews;
              sendNotification(framework, theBot, jiraEvent, author,
                watcherNews.description, ' that you are watching.',
                '', watcherNews.change, null, cb);
            });
          } else {
            logger.verbose('No bot found for potential recipient:' + email);
            // Test framework does NOT want to be notified of potential watchers who don't get a message so no cb
          }
        });
      }).catch(function (err) {
        logger.warn('Unable to get any watcher info from %s, :%s',
          jiraEvent.fields.watches.self, err.message);
      });
    } else {
      logger.verbose('No watchers of this issue to notify');
    }
  } catch (err) {
    logger.error('Error processing watchers: ' + err.message);
  }
}

// Figure out how to characterize a JiraEvent for the watchers
function getWatcherNews(jiraEvent) {
  let watcherNews = {
    description: ' updated a Jira ',
    change: ''
  };
  //let changedField = '';

  if ((jiraEvent.changelog) && (jiraEvent.changelog.items[0]) &&
    (jiraEvent.changelog.items[0].field)) {
    changedField = jiraEvent.changelog.items[0].field;
  }

  if (jiraEvent.webhookEvent === 'jira:issue_updated') {
    if (jiraEvent.issue_event_type_name === 'issue_commented') {
      watcherNews.description = ' commented on a Jira ';
      watcherNews.change = jiraEvent.comment.body;
    } else if (jiraEvent.issue_event_type_name === 'issue_comment_edited') {
      watcherNews.description = ' uppdated a comment on a Jira ';
      watcherNews.change = jiraEvent.comment.body;
    } else if (jiraEvent.issue_event_type_name === 'issue_comment_deleted') {
      watcherNews.description = ' deleted a comment on a Jira ';
    } else {
      watcherNews.change = getNewsFromChangelong(jiraEvent, watcherNews.change);
    }
  } else if ((jiraEvent.webhookEvent === 'jira:issue_created') &&
    (jiraEvent.issue_event_type_name === 'issue_created')) {
    watcherNews.description = ' created a Jira ';
    watcherNews.change = jiraEvent.issue.fields.description;
  } else if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
    watcherNews.description = ' deleted a Jira ';
    watcherNews.change = jiraEvent.issue.fields.description;
  } else {
    logger.error('Using generic watcherNews for %s:%s_%s', jiraEvent.timestamp, jiraEvent.webhookEvent, jiraEvent.issue_event_type_name);
    createTestCase(null, jiraEvent, 'no-type-handler');
  }
  return watcherNews;
}

function getNewsFromChangelong(jiraEvent, change) {
  if (!jiraEvent.changelog) {
    let jiraKey = jiraEvent.issue ? jiraEvent.issue.key : '';
    logger.error('No changelong for %s eventtype:%s, issue_type:%s',
      jiraKey, jiraEvent.issue_event_type_name, jiraEvent.issue_event_type_name);
    createTestCase(null, jiraEvent, 'no-changelog');
    return change;
  };
  for (let i = 0, len = jiraEvent.changelog.items.length; i < len; i++) {
    let item = jiraEvent.changelog.items[i];
    if (item.field) {
      if (change) {change += ', and ';}
      change += 'updated field:' + item.field;
      if ((item.field != 'description') && (item.fromString)) {
        change += ' from:"' + item.fromString + '"';
      }
      if (item.toString) {
        change += ' to:"' + jiraEvent.changelog.items[0].toString + '"';
      }
    }
  }
  if (!change) {
    let jiraKey = jiraEvent.issue ? jiraEvent.issue.key : '';
    logger.error('Unable to find a changed field for %s eventtype:%s, issue_type:%s',
      jiraKey, jiraEvent.issue_event_type_name, jiraEvent.issue_event_type_name);
    createTestCase(null, jiraEvent, 'no-change');
  }
  return change;
}


// helper function to build a list of all the mentioned users in a description or comment
function getAllMentions(str) {
  let mentionsRegEx = /\[~(\w+)\]/g;
  let mentions = [];
  // TODO -- update this to populate with full emails
  str.replace(mentionsRegEx, function (match, username) {
    mentions.push(username);
  });
  return mentions;
}

function sendNotification(framework, bot, jiraEvent, author, eventName, action, elementName, elementValue, userConfig, cb) {
  if ((bot.isDirectTo == jiraEvent.user.emailAddress) &&
    ((!userConfig) || (!userConfig.hasOwnProperty('notifySelf')) || (!userConfig.notifySelf))) {
    logger.info('Not sending notification of update made by ' + bot.isDirectTo + ' to ' + jiraEvent.user.emailAddress);
    return;
  }
  logger.info('Sending a notification to ' + bot.isDirectTo + ' about ' + jiraEvent.issue.key);
  let msg = author + eventName + jiraEvent.issue.fields.issuetype.name +
    ': **' + jiraEvent.issue.fields.summary + '**' + action + '\n\n';

  if ((elementName) || (elementValue)) {
    // Try replacing newlines with <br > to keep all the text in one block
    if (elementName) {
      elementName = elementName.replace(/(?:\r\n\r\n|\r\n|\r|\n)/g, '<br />');
    }
    if (elementValue) {
      elementValue = elementValue.replace(/(?:\r\n\r\n|\r\n|\r|\n)/g, '<br />');
    }
    msg += '>' + elementName + elementValue + '\n\n';
  }
  msg += 'https://jira-eng-gpk2.cisco.com/jira/browse/' + jiraEvent.issue.key;
  bot.say({markdown: msg});
  // Store the key of the last notification in case the user wants to reply
  let lastNotifiedIssue = {
    storyUrl: jiraEvent.issue.self,
    storyKey: jiraEvent.issue.key
  };
  bot.store('lastNotifiedIssue', lastNotifiedIssue);
  if (cb) {cb(null, bot);}
}

// Dump the Jira Event to a file to see what the contents are
var fs = require('fs');
function logJiraEvent(jiraEvent) {  // eslint-disable-line no-unused-vars
  fs.writeFile("./JiraEvents/" + jiraEvent.timestamp + '-' + jiraEvent.webhookEvent +
    ".json", JSON.stringify(jiraEvent, null, 4), (err) => {
      if (err) {
        logger.error('Error writing jira event to disk:' + err);
      }
    });
}

function createTestCase(e, jiraEvent, changedField = '') {
  let filename = `./potential-jira-event-test-cases/${jiraEvent.timestamp}` +
    `-${jiraEvent.webhookEvent}-${changedField}.error`;
  // TODO what is this "changedField"
  fs.writeFile(filename, JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
      logger.error('Error writing jira event to disk:' + err);
    }
    if (e) {
      fs.appendFile(filename, JSON.stringify(e, null, 4), (err) => {
        if (err) {
          logger.error('Error writing jira event to disk:' + err);
        }
      });
    }
  });
}
