// jira-event.js
//
// An object for checking if Jira Events are relevant to Spark users who are
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

logger = require('./logger');
let when = require('when');

// Set regular expressions to discover the type of events we are getting
const commentEvent = new RegExp(/^comment_/);
const issueEvent = new RegExp(/^jira:issue_/);
const issueEventWithComment = new RegExp(/^issue_comment/);

/**
 * A module for Webex Bots to process webhook events from jira
 *
 * @module JiraEventHandler
 */
class JiraEventHandler {
  /**
   * JiraEventHandler constructor needs a JiraConnector object
   *
   * @param {object} jiraConnector -- an instantiated jiraConnector object
   * @param {object} [groupSpaceConfig] - option config with rules to notify 
   *                           of certain events in group spaces. 
   */
  constructor(jiraConnector, groupSpaceConfig = null) {
    /** @private */
    this.jiraConnector = jiraConnector;
    this.groupSpaceConfig = groupSpaceConfig;
  }

  /**
   * processJiraEvent
   * 
   * Called by the Webex Node Bot Framework based application
   * This inspect the jira event and determines if any instances of
   * the bot should send messages to the spaces they are in to inform
   * users of the recent jira event
   * 
   * @param {object} jiraEvent - body of the jira webhook received
   * @param {object} framework - webex bot framework object
   * @param {function} [cb] - callback used for testing.  If set this will be
   *                          called each time a possible message recipient is 
   *                          detected.  If they are a bot user the message
   *                          is also included. 
   */
  processJiraEvent (jiraEvent, framework, cb = null) {
    if (process.env.LOG_JIRA_EVENTS === 'true') {
      logJiraEvent(jiraEvent);
    }
    try {

      if (commentEvent.test(jiraEvent.webhookEvent)) {
        if (!process.env.PROCESS_COMMENT_EVENTS) {
          logger.info(`Ignoring webhookEvent: "${jiraEvent.webhookEvent}, ` +
          `Will use issue_updated event instead.`);
          return;
        }
        logger.info(`Processing incoming Jira comment event: ${jiraEvent.webhookEvent}`);
        return processCommentEvent(jiraEvent, framework, this.jiraConnector, cb);
      } else if (issueEvent.test(jiraEvent.webhookEvent)) {
        logger.info(`Processing incoming Jira issue event: "${jiraEvent.issue_event_type_name}", Issue Key: "${jiraEvent.issue.key}"`);
        return processIssueEvent(jiraEvent, framework, this.jiraConnector, this.groupSpaceConfig, cb);
      } else {
        logger.warn(`Ignoring unknown webhookEvent: "${jiraEvent.webhookEvent}`);
        return;
      }
    } catch (e) {
      logger.error(`processJiraEvent() got exception: ${e.message}`);
    }
  }
}
module.exports = JiraEventHandler;

function processIssueEvent(jiraEvent, framework, jira, groupSpaceConfig, cb) {
  try {
    let toNotifyList = [];
    let issue = jiraEvent.issue;
    // If this is an issue event typ comment_created/updated event we may ignore it or
    // process it depending on how we are configured...
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
      (issueEventWithComment.test(jiraEvent.issue_event_type_name))) {
      if (process.env.PROCESS_COMMENT_EVENTS) {
        logger.verbose(`Ignoring issue_updated for a ` +
        `${jiraEvent.issue_event_type_name} for ${jiraEvent.issue.key}.` +
        `Expecting a new comment_[created/deleted] event instead`);
        return;
      }
    }

    // There are some events that we will just ignore:
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
    (jiraEvent.issue_event_type_name === 'issue_comment_deleted')) {
      logger.verbose('Ignoring comment_deleted event');
      return;
    }

    // See if there are watchers for this issue and fetch them while we look for mentions
    let watcherPromise = jira.lookupWatcherInfoFromIssue(issue);

    // While waiting for the watchers set up the msgElements and notify
    // the assignee and anyone mentioned
    let msgElements = generateMsgElements(jiraEvent, jira, toNotifyList);

    // Notify assignee and mentioned users...
    notifyMentioned(framework, msgElements, toNotifyList, jira, cb);

    // Evaluate and potentially notify group spaces about this event
    if ((groupSpaceConfig) && (typeof groupSpaceConfig === 'object')) {
      groupSpaceConfig.evaluateForGroupSpaceNotification(msgElements, 
        buildWatcherOrAssigneeMessage, cb);
    }

    // Wait for and process the watchers (if any)
    if (!watcherPromise) {
      return;
    }
    return when(watcherPromise).then((watcherInfo) => {
      return processWatcherInfo(framework, watcherInfo, toNotifyList, msgElements, jira, cb);
    }).catch((e) => {
      logger.warn(`Failed getting watchers associated with issue ${jiraEvent.issue.key}: ` +
        `"${e.message}". Can only notify the assignee and mentioned users.`);
      // createTestCase(e, jiraEvent, framework, 'process-watcher-error');
    });

  } catch (e) {
    logger.error(`processIssueEvent() caught error: ${e.message}`);
    createTestCase(e, jiraEvent, framework, 'process-issue-error');
  }
};

function generateMsgElements(jiraEvent, jira, toNotifyList = null) {
  let user = jiraEvent.user;
  let issue = jiraEvent.issue;
  try {
    msgElements = {
      author: user.displayName,
      authorEmail: user.emailAddress,
      issueKey: issue.key,
      issueUrl: `${jira.getJiraUrl()}/browse/${issue.key}`,
      issueType: issue.fields.issuetype.name,
      issueSummary: jiraEvent.issue.fields.summary,
      issueSelf: issue.self,
      jiraEvent: jiraEvent  
    };

    if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
    (issueEventWithComment.test(jiraEvent.issue_event_type_name))) {
      // Configure notifylist and msgElements with the comment body
      if (toNotifyList) {
        addMentionsToNotifyList(jiraEvent.comment.body, toNotifyList);
      }
      msgElements.subject = "comment";
      msgElements.action = (jiraEvent.issue_event_type_name === 'issue_commented') ?
        "created" : "updated";
      msgElements.body = convertNewlines(jiraEvent.comment.body);
    } else {
      // Configure notifylist and msgElements with the issue summary
      if (toNotifyList) {
        addMentionsToNotifyList(issue.fields.description, toNotifyList);
      }
      msgElements.subject = "issue";
      if (jiraEvent.webhookEvent === 'jira:issue_deleted') {
        msgElements.action = 'deleted';
      } else {
        msgElements.action = jiraEvent.issue_event_type_name.substr(
          "issue_".length, jiraEvent.webhookEvent.length);;  
      }
      msgElements.body = convertNewlines(issue.fields.description);
    }

    if (issue.fields.assignee) {
      if (typeof issue.fields.assignee === "object") {
        msgElements.assignee = issue.fields.assignee.name;
      } else {
        msgElements.assignee = issue.fields.assignee; 
      }
      if ((toNotifyList) && 
        (toNotifyList.indexOf(msgElements.assignee) === -1)) {
        toNotifyList.push(msgElements.assignee);
      }
    }
    // Handle some more complex events
    if ((msgElements.subject === "issue") && (msgElements.action === 'created') && (issue.fields.assignee)) {
      // Set action to assigned to when issue was assigned when it was created
      msgElements.action = 'assigned';
    } else if ((jiraEvent.webhookEvent === 'jira:issue_updated') &&
      (!issueEventWithComment.test(jiraEvent.issue_event_type_name)) &&
      (msgElements.action !== 'moved')) {
      // Discover the updated event from the changelog
      if (jiraEvent.changelog && jiraEvent.changelog.items) {
        msgElements.action = '';
        if (jiraEvent.changelog.items.length > 1) {
          // We prefer to notify about a status change if there was more than one
          let statusItem = jiraEvent.changelog.items.find((item) => item.field === "status");
          if (statusItem) {
            msgElements.action = "status";
            msgElements.updatedTo = statusItem.toString;
            msgElements.updatedFrom = statusItem.fromString;
          }
        }
        // Otherwise we take the first thing in the changelog
        if (msgElements.action === '') {
          msgElements.action = jiraEvent.changelog.items[0].field;
          // clean up some of the action names for better message syntax
          if (msgElements.action === 'assignee') {
            msgElements.action = 'assigned'; 
          } else if (msgElements.action === 'Attachment') {
            msgElements.action = 'attachments'; 
          } else if (msgElements.action === 'duedate') {
            msgElements.action = 'due date'; 
          }
          msgElements.updatedTo = jiraEvent.changelog.items[0].toString;
          msgElements.updatedFrom = jiraEvent.changelog.items[0].fromString;
        }
      }
    }
    return msgElements;
  } catch(e) {
    logger.error(`generateMsgElements() caught error: ${e.message}`);
    throw(e);
  }
}

function processCommentEvent(jiraEvent, framework, jira, cb) {
  try {
    let msgElements = {};
    let event = jiraEvent.webhookEvent.substr("comment_".length,
      jiraEvent.webhookEvent.length);

    // Try to fetch the issue this comment is associated with
    let issuePromise = jira.lookupIssueFromCommentEvent(jiraEvent);

    // While waiting for that, scan comment for mentions...
    let toNotifyList = [];
    addMentionsToNotifyList(jiraEvent.comment.body, toNotifyList);
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
      let watcherPromise = jira.lookupWatcherInfoFromIssue(issue);

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
      return processWatcherInfo(framework, watcherInfo,
        toNotifyList,msgElements, jira, cb);
    }).catch((e) => {
      logger.error(`processCommentEvent() got error: "${e.message}". ` +
        `May have only notified people mentioned in the comment or none at all.`);
      // createTestCase(e, jiraEvent, framework, 'caught-error');
    });

  } catch (e) {
    logger.error(`processCommentEvent(): caught error: ${e.message}`);
    createTestCase(e, jiraEvent, framework, 'process-comment-error');
  }
};

function processWatcherInfo(framework, watcherInfo, notifiedList, msgElements, jira, cb) {
  if (watcherInfo) {
    watchers = watcherInfo.watchers;
    watcherEmails = [];
    for (let i = 0; i < watchers.length; i++) {
      if (!notifiedList.find((user) => user === watchers[i].name)) {
        watcherEmails.push(watchers[i].emailAddress);
      }
    }
    return when(notifyWatchers(framework, msgElements, watcherEmails, jira, cb));
  } else {
    return when(true);
  }
}

async function notifyMentioned(framework, msgElements, notifyList, jira, cb) {
  if (!notifyList.length) {
    logger.verbose('No mentioned users to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return when();
  }
  // Lookup the user details for each mention (username)
  let mentionedUserPromises = [];
  let mentionedEmails = [];
  notifyList.forEach((user) => {
    // Convert the usernames to emails in order to associate with a bot user
    mentionedUserPromises.push(jira.getUserObjectFromUsername(user).then((userObj) => {
      mentionedEmails.push(userObj.emailAddress);
      if ((msgElements.assignee) && (msgElements.assignee === userObj.name)) {
        // If this was an assignment and this is the assignee add som extra info
        msgElements.assignedTo = userObj.displayName;
        msgElements.assignedToEmail = userObj.emailAddress;
      }
    }).catch((e) => {
      // User lookup failed, log it and move on.
      logger.error(`notifyMentioned() caught exception: ${e.message}`);
      createTestCase(e, msgElements.jiraEvent, framework, 'lookup-user-error'); 
    }).finally(() => when(true)));
  });

  return when.all(mentionedUserPromises).then(() => {
    return notifyBotUsers(framework, "mentioned", msgElements, mentionedEmails, jira, cb);
  }).catch((e) => {
    logger.error(`notifyMentioned() caught exception: ${e.message}`);
    createTestCase(e, msgElements.jiraEvent, framework, 'notify-users-error'); 
    return when();
  });
}

function notifyWatchers(framework, msgElements, watchers, jira, cb) {
  if (!watchers.length) {
    logger.verbose('No watchers to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return;
  }
  notifyBotUsers(framework, "watcher", msgElements, watchers, jira, cb);
}

function notifyBotUsers(framework, recipientType, msgElements, emails, jira, cb) {
  emails.forEach((email) => {
    //let email = user + '@' + emailOrg;
    let bot = framework.bots.find(function (bot) {return (bot.isDirectTo === email);});
    if (bot) {
      let theBot = bot;
      theBot.recall('userConfig').then(function (userConfig) {
        if (userConfig.askedExit) {
          return logger.info('Supressing message to ' + theBot.isDirectTo);
        }
        sendWebexNotification(theBot, recipientType, userConfig, msgElements, jira, cb);
        // TODO - See if this is still needed given that we now REQUIRE API access to work
        // Add instrumentation to find users who are not working in dissallowed projects
        // if (jiraEvent.ourProjectIdx == -1) {
        //   logger.error(email + ' is working on project ' + jiraEvent.issue.key);
        // }
      }).catch(function (err) {
        logger.error('Unable to get quietMode status for ' + theBot.isDirectTo);
        logger.error(err.message);
        logger.error('Erring on the side of notifying them.');
        createTestCase(e, msgElements.jiraEvent, framework, 'bot-recall-error'); 
        sendWebexNotification(theBot, recipientType, {notifySelf: true}, msgElements, cb);
      });
    } else {
      logger.verbose('No bot found for potential recipient:' + email);
      // Test framework wants to know if a user who was mentioned or assigned does NOT get a message
    }
  });
}

function sendWebexNotification(bot, recipientType, userConfig, msgElements, jira, cb) {
  if ((bot.isDirectTo === msgElements.authorEmail) &&
    ((!userConfig) || (!userConfig.hasOwnProperty('notifySelf')) || (!userConfig.notifySelf))) {
    logger.info('Not sending notification ' + bot.isDirectTo + ' about their own change.');
    return;
  }
  if ((recipientType === 'watcher') &&
    ((!userConfig) || (!userConfig.hasOwnProperty('watcherMsgs')) || (!userConfig.watcherMsgs))) {
    logger.info(bot.isDirectTo + ' has watcher notifications turned off.  Not sending notification.');
    return;
  }
  let msg;
  switch (recipientType) {
    case ('mentioned'):
      if (msgElements.assignedToEmail === bot.isDirectTo) {
        msg = buildWatcherOrAssigneeMessage(msgElements, bot.isDirectTo, jira);
      } else {
        msg = buildMentionedMessage(msgElements, bot.isDirectTo, jira);
      }
      break;
    case ('watcher'):
      msg = buildWatcherOrAssigneeMessage(msgElements, bot.isDirectTo, jira);
      break;
    default:
      logger.error(`Cannot build message for unknown recipient ` +
        `type: ${recipientType}`);
      createTestCase(null, msgElements.jiraEvent, framework, `recipient-type-${recipientType}-error`); 
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

function buildMentionedMessage(msgElements, botEmail, jira) {
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
        } else if (msgElements.action === 'resolution') {
          msg = `${msgElements.author} changed the resolution state to "${msgElements.updatedTo}" for Jira ${msgElements.issueType}: `;
        } else {
          logger.warn(`buildMentionedMessage: Unsure how to format message for ` +
            `action:${msgElements.action} in ${JSON.stringify(msgElements, 2, 2)}`);
        }
//        msg += `**${msgElements.issueSummary}**.\n\n${msgElements.body}\n\n`;
        msg += `**${msgElements.issueSummary}**.\n\n`;
        break;

      default:
        logger.warn(`buildMentionedMessage: Unsure how to format message for ` +
          `subject:${msgElements.subject} in ${JSON.stringify(msgElements, 2, 2)}`);
    }
    msg += msgElements.issueUrl;
    return msg;
  } catch (e) {
    throw new Error(`buildMentionedMessage failed: ${e.message}`);
  }
}

function buildWatcherOrAssigneeMessage(msgElements, botEmail, jira) {
  try {
    let msg = ``;
    switch (msgElements.subject) {
      case ('comment'):
        msg = `${msgElements.author} ${msgElements.action} a comment on a `;
        break;

      case ('issue'):
        if ((msgElements.action === 'created') || (msgElements.action === 'updated') || (msgElements.action === 'moved')) {
          msg = `${msgElements.author} ${msgElements.action} a `;
        } else if (msgElements.action === 'assigned') {
          if (msgElements.assignedToEmail === botEmail) {
            msg = `You were assigned to a Jira ${msgElements.issueType} by ${msgElements.author}: **${msgElements.issueSummary}**.\n\n`;
          } else {
            msg = `${msgElements.author} assigned ${msgElements.assignedTo} to a Jira ${msgElements.issueType}: **${msgElements.issueSummary}**.\n\n`;
          }
        } else if (msgElements.action === 'status') {
          msg = `${msgElements.author} changed the status to "${msgElements.updatedTo}" for `;
        } else if (msgElements.action === 'resolution') {
          msg = `${msgElements.author} set the resolution state to "${msgElements.updatedTo}" for `;
        } else if (msgElements.action === 'description') {
          msg = `${msgElements.author} updated the description of a `;
        } else if (msgElements.action === 'deleted') {
          msg = `${msgElements.author} deleted a `;
        } else {
          msg = `${msgElements.author} changed the ${msgElements.action} for `;
          logger.warn(`buildWatcherOrAssigneeMessage: Got an issue with msgElments.action=${msgElements.action},` +
            `Setting a generic message: "${msg}"`);
          //msg = `${msgElements.author} made an update to a `;
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
      } else if (botEmail) {
        msg += ` that you are watching.\n\n`;
      } else {
        msg += `.\n\n`;
      }
    } 

    if ((msgElements.subject === 'comment') || (!botEmail) ||
      ((msgElements.action === 'assigned') && (msgElements.assignedToEmail === botEmail))) {
      msg += `${msgElements.body}\n\n`;
    }
    msg += `${jira.getJiraUrl()}/browse/${msgElements.issueKey}`;
    return msg;
  } catch (e) {
    throw new Error(`buildWatcherOrAssigneeMessage failed: ${e.message}`);
  }
}

function convertNewlines(text) {
  if (!text) {
    return '';
  }
  return text.replace(/(?:\r\n\r\n|\r\n|\r|\n)/g, '<br />');
}

// helper function to build a list of all the mentioned users in a description or comment
function addMentionsToNotifyList(str, toNotify) {
  if (!str) {
    return [];
  }
  let mentionsRegEx = /\[~(\w+)\]/g;
  //let mentions = [];
  // TODO -- update this to populate with full emails
  str.replace(mentionsRegEx, function (match, username) {
    toNotify.push(username);
  });
}


// Dump the Jira Event to a file to see what the contents are
var fs = require('fs');
function logJiraEvent(jiraEvent) {  // eslint-disable-line no-unused-vars
  let filename = buildFilename(`./JiraEvents`, jiraEvent);
  fs.writeFile(filename, JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
      logger.error('Error writing jira event to disk:' + err);
    }
  });
  logger.info(`Saving ${filename}`);
}

function createTestCase(e, jiraEvent, framework, changedField = '') {
  let filename = buildFilename(`./potential-jira-event-test-cases`,
    jiraEvent, changedField);
  fs.writeFile(filename, JSON.stringify(jiraEvent, null, 4), (err) => {
    if (err) {
      logger.error('createTestCase() Error writing jira event to disk:' + err);
    }
    if ((process.env.ADMIN_EMAIL) && (typeof framework.webex === 'object')) {
      // Message the admin about this 
      let msg = {
        toPersonEmail: process.env.ADMIN_EMAIL,
        // filename,
        markdown: `Got an error processing event`,
        files: [ fs.createReadStream(filename) ]
      };
      if (e && e.message) {
        msg.markdown += `: **${e.message}**`;
      }
      framework.webex.messages.create(msg)
        .catch((err) => {
          logger.error(`Failed to post message to admin about error: ${err.message}`);
        });
    }
  });
}

function buildFilename(path, jiraEvent, changedField = '') {
  // ToDo - could probably improve handling if certain elements are missing
  let filename = `${path}/${jiraEvent.timestamp}_`;
  if ((typeof jiraEvent.issue === 'object') && (jiraEvent.issue.key)){
    filename += `${jiraEvent.issue.key}`;
  } 
  filename += `-${jiraEvent.webhookEvent}`;
  if (jiraEvent.issue_event_type_name) {
    filename += `-${jiraEvent.issue_event_type_name}`;
  } 
  if (changedField) {
    filename += `-${changedField}`;
  }
  filename += `.json`;
  return filename;
}
