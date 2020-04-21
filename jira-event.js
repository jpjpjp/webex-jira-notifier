// jira-event.js
//
// An object for checking if Jira Events are relevant to Spark users who are
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();
logger = require('./logger');
let when = require('when');

let JiraConnector = require('./jira-connector');
let jiraConnector = new JiraConnector();
let jira_url = jiraConnector.getJiraUrl();

// Set regular expressions to discover the type of events we are getting
const commentEvent = new RegExp(/^comment_/);
const issueEvent = new RegExp(/^jira:issue_/);
const issueEventWithComment = new RegExp(/^issue_comment/);


//Determine which event we have.  If its one we care about see if it belongs
// to someone in a room with our bot
exports.processJiraEvent = function (jiraEvent, framework, cb = null) {
  logJiraEvent(jiraEvent);
  try {
    // We'll also notify any watchers of this change 
    //(but only once even if multiple things changed)
    // TODO -- is this needed anymore?
    jiraEvent.watchersNotified = false;

    if (commentEvent.test(jiraEvent.webhookEvent)) {
      if (process.env.USE_ISSUE_UPDATED_FOR_COMMENTS) {
        logger.info(`Ignoring webhookEvent: "${jiraEvent.webhookEvent}, ` +
          `Will use issue_updated event instead.`);
        return;
      }
      logger.info(`Processing incoming Jira comment event: ${jiraEvent.webhookEvent}`);
      return processCommentEvent(jiraEvent, framework, cb);
    } else if (issueEvent.test(jiraEvent.webhookEvent)) {
      logger.info(`Processing incoming Jira issue event: "${jiraEvent.issue_event_type_name}", Issue Key: "${jiraEvent.issue.key}"`);
      return processIssueEvent(jiraEvent, framework, cb);
    } else {
      logger.warn(`Ignoring unknown webhookEvent: "${jiraEvent.webhookEvent}`);
      return;
    }
  } catch (e) {
    logger.error(`processJiraEvent() got exception: ${e.message}`);
  }
};

function processIssueEvent(jiraEvent, framework, cb) {
  try {
    let msgElements = {};
    let event = jiraEvent.issue_event_type_name.substr("issue_".length,
      jiraEvent.webhookEvent.length);
    let user = jiraEvent.user;
    let issue = jiraEvent.issue;
    let toNotifyList = [];

    // If this is an issue event typ comment_created/updated event we may ignore it or
    // process it depending on how we are configured...
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
      (issueEventWithComment.test(jiraEvent.issue_event_type_name))) {
      if (!process.env.USE_ISSUE_UPDATED_FOR_COMMENTS) {
        logger.verbose(`Igoring issue_updated for a ` +
        `${jiraEvent.issue_event_type_name} for ${jiraEvent.issue.key}.` +
        `Expecting a new comment_[created/deleted] event instead`);
        return;
      }
    }

    // TODO figure out how/if this is still relevent
    // The new module pretty much REQUIRES full access to Jira to work
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
    let watcherPromise = jiraConnector.lookupWatcherInfoFromIssue(issue);

    // While waiting for the watchers set up the msgElements and notify
    // the assignee and anyone mentioned
    msgElements = {
      author: user.displayName,
      authorEmail: user.emailAddress,
      issueKey: issue.key,
      issueType: issue.fields.issuetype.name,
      issueSummary: jiraEvent.issue.fields.summary,
      issueSelf: issue.self
    };


    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
    (issueEventWithComment.test(jiraEvent.issue_event_type_name))) {
      // Configure notifylist and msgElements with the comment body
      toNotifyList = getAllMentions(jiraEvent.comment.body);
      msgElements.subject = "comment";
      msgElements.action = (jiraEvent.issue_event_type_name === 'issue_commented') ?
        "created" : "updated";
      msgElements.body = convertNewlines(jiraEvent.comment.body);
    } else {
      // Configure notifylist and msgElements with the issue summary
      toNotifyList = getAllMentions(issue.fields.description);
      msgElements.subject = "issue";
      msgElements.action = event;
      msgElements.body = convertNewlines(issue.fields.description);
    }

    if (issue.fields.assignee) {
      msgElements.assignee = issue.fields.assignee.name;
      if (toNotifyList.indexOf(msgElements.assignee) === -1) {
        toNotifyList.push(msgElements.assignee);
      }
    }
    // Handle some more complex events
    if ((msgElements.subject === "issue") && (event === 'created') && (issue.fields.assignee)) {
      // Discover assigned to when issue was assigned when it was created
      msgElements.action = 'assigned';
      msgElements.assignee = issue.fields.assignee.name;
      if (!toNotifyList.find((user) => user === msgElements.assignee)) {
        toNotifyList.push(msgElements.assignee);
      }
    } else if (event === 'assigned') {
      if (jiraEvent.changelog && jiraEvent.changelog.items) {
        msgElements.assignee = jiraEvent.changelog.items[0].to;
        if (!toNotifyList.find((user) => user === msgElements.assignee)) {
          toNotifyList.push(msgElements.assignee);
        }
      }
    } else if (event === 'generic') {
      // Discover the generic event from the changelog
      if (jiraEvent.changelog && jiraEvent.changelog.items) {
        msgElements.action = jiraEvent.changelog.items[0].field;
        msgElements.updatedTo = jiraEvent.changelog.items[0].toString;
      }
    }
  
    // Notify assignee and mentioned users...
    notifyMentioned(framework, msgElements, toNotifyList, cb);

    // Wait for and process the watchers (if any)
    if (!watcherPromise) {
      return;
    }
    return when(watcherPromise).then((watcherInfo) => {
      return processWatcherInfo(framework, watcherInfo, toNotifyList, msgElements, cb);
    }).catch((e) => {
      logger.error(`Failed getting watchers associated with issue ${jiraEvent.issue.key}: ` +
        `"${e.message}". Can only notify people mentioned in the description.`);
      createTestCase(e, jiraEvent, 'caught-error');
    });

  } catch (e) {
    logger.error(`processIssueEvent() caught error: ${e.message}`);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};


function processCommentEvent(jiraEvent, framework, cb) {
  try {
    let msgElements = {};
    let event = jiraEvent.webhookEvent.substr("comment_".length,
      jiraEvent.webhookEvent.length);

    // Try to fetch the issue this comment is associated with
    let issuePromise = jiraConnector.lookupIssueFromCommentEvent(jiraEvent);

    // While waiting for that, scan comment for mentions...
    let toNotifyList = getAllMentions(jiraEvent.comment.body);
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
      let watcherPromise = jiraConnector.lookupWatcherInfoFromIssue(issue);

      // While waiting, add to msgElements with issue details
      if (issue.fields.assignee) {
        msgElements.assignee = issue.fields.assignee.key;
        if (toNotifyList.indexOf(msgElements.assignee) === -1) {
          toNotifyList.push(msgElements.assignee);
        }
      }
      msgElements.issueType = issue.fields.issuetype.name;
      msgElements.issueSummary = convertNewlines(issue.fields.summary);
      msgElements.issueKey = issue.key;
      msgElements.issueSelf = issue.self;
      notifyMentioned(framework, msgElements, toNotifyList, cb);

      // Wait for the watchers (if any)
      if (watcherPromise) {
        return when(watcherPromise);
      } else {
        return when(null);
      }
    }).then((watcherInfo) => {
      return processWatcherInfo(framework, watcherInfo, toNotifyList, msgElements, cb);
    }).catch((e) => {
      logger.error(`processCommentEvent() got error: "${e.message}". ` +
        `May have only notified people mentioned in the comment or none at all.`);
      createTestCase(e, jiraEvent, 'caught-error');
    });

  } catch (e) {
    logger.error(`processCommentEvent(): caught error: ${e.message}`);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

function processWatcherInfo(framework, watcherInfo, notifiedList, msgElements, cb) {
  if (watcherInfo) {
    watchers = watcherInfo.watchers;
    watcherEmails = [];
    for (let i = 0; i < watchers.length; i++) {
      if (!notifiedList.find((user) => user === watchers[i].name)) {
        watcherEmails.push(watchers[i].emailAddress);
      }
    }
    return when(notifyWatchers(framework, msgElements, watcherEmails, cb));
  } else {
    return when(true);
  }
}

async function notifyMentioned(framework, msgElements, notifyList, cb) {
  if (!notifyList.length) {
    logger.verbose('No mentioned users to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return when();
  }
  // Lookup the user details for each mention (username)
  let mentionedUserPromises = [];
  for (let i = 0; i < notifyList.length; i++) {
    mentionedUserPromises.push(jiraConnector.lookupUser(notifyList[i]));
  }
  let mentionedEmails = [];
  return when.all(mentionedUserPromises).then((users) => {
    // Convert the usernames to emails in order to associate with a bot user
    for (let i = 0; i < users.length; i++) {
      mentionedEmails.push(users[i].emailAddress);
      if ((msgElements.assignee) && (msgElements.assignee === users[i].name)) {
        // If this was an assignment and this is the assignee add som extra info
        msgElements.assignedTo = users[i].displayName;
        msgElements.assignedToEmail = users[i].emailAddress;
      }
    }
    return notifyBotUsers(framework, "mentioned", msgElements, mentionedEmails, cb);
  }).catch((e) => {
    logger.error(`notifyMentioned() caught exception: ${e.message}`);
    return when();
  });
}

function notifyWatchers(framework, msgElements, watchers, cb) {
  if (!watchers.length) {
    logger.verbose('No watchers to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return;
  }
  notifyBotUsers(framework, "watcher", msgElements, watchers, cb);
}

function notifyBotUsers(framework, recipientType, msgElements, emails, cb) {
  emails.forEach((email) => {
    //let email = user + '@' + emailOrg;
    let bot = framework.bots.find(function (bot) {return (bot.isDirectTo === email);});
    if (bot) {
      let theBot = bot;
      theBot.recall('userConfig').then(function (userConfig) {
        if (userConfig.askedExit) {
          return logger.info('Supressing message to ' + theBot.isDirectTo);
        }
        sendWebexNotification(theBot, recipientType, userConfig, msgElements, cb);
        // TODO - See if this is still needed given that we now REQUIRE API access to work
        // Add instrumentation to find users who are not working in dissallowed projects
        // if (jiraEvent.ourProjectIdx == -1) {
        //   logger.error(email + ' is working on project ' + jiraEvent.issue.key);
        // }
      }).catch(function (err) {
        logger.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        logger.error(err.message);
        logger.error('Erring on the side of notifying them.');
        sendWebexNotification(theBot, recipientType, userConfig, msgElements, cb);
      });
    } else {
      logger.verbose('No bot found for potential recipient:' + email);
      // Test framework wants to know if a user who was mentioned or assigned does NOT get a message
      if (cb) {return (cb(null, null));}
    }
  });
}

function sendWebexNotification(bot, recipientType, userConfig, msgElements, cb) {
  if ((bot.isDirectTo == msgElements.authorEmail) &&
    ((!userConfig) || (!userConfig.hasOwnProperty('notifySelf')) || (!userConfig.notifySelf))) {
    logger.info('Not sending notification of update made by ' + bot.isDirectTo + ' to ' + msgElements.authorEmai);
    return;
  }
  let msg;
  switch (recipientType) {
    case ('mentioned'):
      if (msgElements.assignedToEmail === bot.isDirectTo) {
        msg = buildWatcherOrAssigneeMessage(msgElements, bot.isDirectTo);
      } else {
        msg = buildMentionedMessage(msgElements, bot.isDirectTo);
      }
      break;
    case ('watcher'):
      msg = buildWatcherOrAssigneeMessage(msgElements, bot.isDirectTo);
      break;
    default:
      logger.error(`Cannot build message for unknown recipeient ` +
        `type: ${recipientType}`);
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
          logger.warn(`buildMentionedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
        msg += `Jira ${msgElements.issueType}: **${msgElements.issueSummary}**.` +
          `\n\n${msgElements.body}\n\n`;
        break;

      case ('issue'):
        msg += `You were mentioned in a Jira ${msgElements.issueType} `;
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
          logger.warn(`buildMentionedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
        msg += `**${msgElements.issueSummary}**.\n\n${msgElements.body}\n\n`;
        break;

      default:
        logger.warn(`buildMentionedMessage: Unsure how to format message for ` +
          `subject:${msgElements.subject} in ${JSON.stringify(msgElements, 2, 2)}`);
    }
    msg += `${jira_url}/browse/${msgElements.issueKey}`;
    return msg;
  } catch (e) {
    throw new Error(`buildMentionedMessage failed: ${e.message}`);
  }
}

function buildWatcherOrAssigneeMessage(msgElements, botEmail) {
  try {
    let msg = ``;
    switch (msgElements.subject) {
      case ('comment'):
        msg = `${msgElements.author} ${msgElements.action} a comment on a `;
        // if (msgElements.action === 'created') {
        //   msg += 'commented on a ';
        // } else if (msgElements.action === 'updated') {
        //   msg += 'updated a comment on a ';
        // } else {
        //   logger.warn(`buildWatchedMessage: Unsure how to format message for ` +
        //     `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        // }
        break;

      case ('issue'):
        if ((msgElements.action === 'created') || (msgElements.action === 'updated')) {
          msg = `${msgElements.author} ${msgElements.action} a `;
        } else if (msgElements.action === 'assigned') {
          if (msgElements.assignedToEmail === botEmail) {
            msg = `You were assigned to a Jira ${msgElements.issueType} by ${msgElements.author}: **${msgElements.issueSummary}**.\n\n`;
          } else {
            msg = `${msgElements.author} assigned ${msgElements.assignedTo} to a Jira ${msgElements.issueType}: **${msgElements.issueSummary}**.\n\n`;
          }
        } else if (msgElements.action === 'status') {
          msg = `${msgElements.author} changed the status to "${msgElements.updatedTo}" for `;
        } else {
          msg = 'Something happened to a ';
          logger.warn(`buildWatcherOrAssigneeMessage: Unsure how to format message for ` +
            `an issue with msgElments.action=${msgElements.action}.`);
        }
        break;

      default:
        logger.warn(`buildWatcherOrAssigneeMessage: Unsure how to format message for ` +
          `subject:${msgElements.subject} in ${JSON.stringify(msgElements, 2, 2)}`);
    }
    if (!((msgElements.action === 'assigned') && (msgElements.assignedToEmail === botEmail))) {
      msg += `Jira ${msgElements.issueType}: **${msgElements.issueSummary}**`;
      if (msgElements.assignedToEmail === botEmail) {
        msg += ` that you are assigned to.\n\n`;
      } else {
        msg += ` that you are watching.\n\n`;
      }
    }
    msg += `${msgElements.body}\n\n${jira_url}/browse/${msgElements.issueKey}`;
    return msg;
  } catch (e) {
    throw new Error(`buildWatcherOrAssigneeMessage failed: ${e.message}`);
  }
}

function convertNewlines(text) {
  return text.replace(/(?:\r\n\r\n|\r\n|\r|\n)/g, '<br />');
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
