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
//let jiraProjects = null;
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
const oldStyleComment = new RegExp(/^issue_comment_/);


//Determine which event we have.  If its one we care about see if it belongs
// to someone in a room with our bot
exports.processJiraEvent = function (jiraEvent, framework, cb = null) {
  //logJiraEvent(jiraEvent);
  try {
    // We'll also notify any watchers of this change 
    //(but only once even if multiple things changed)
    // TODO -- is this needed anymore?
    jiraEvent.watchersNotified = false;

    if (commentEvent.test(jiraEvent.webhookEvent)) {
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
    // Some jira systems generate both issue and comment events for new comments
    // Lets ignore the old style issue events
    if ((jiraEvent.webhookEvent === 'jira:issue_updated') && 
      (oldStyleComment.test(jiraEvent.issue_event_type_name))) {
      logger.verbose(`Igoring old style issue_updated for a ` +
        `${jiraEvent.issue_event_type_name} for ${jiraEvent.issue.key}`);
      return;
    }

    let msgElements = {};
    let event = jiraEvent.issue_event_type_name.substr("issue_".length,
      jiraEvent.webhookEvent.length);
    let user = jiraEvent.user;
    let issue = jiraEvent.issue;    

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
    let watcherPromise = null;
    let watches = issue.fields.watches;
    if (watches && watches.watchCount && watches.self) {
      // Use a proxy server if configured
      let watcherUrl = watches.self;
      if (jira_url_regexp) {
        watcherUrl = watcherUrl.replace(jira_url_regexp, proxy_url);
      }
      watcherPromise = request.get(watcherUrl, jiraReqOpts);
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
    notifyMentioned(framework, msgElements, toNotifyList, cb);

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
        return when(notifyWatchers(framework, msgElements, watcherEmails, cb));
      } else {
        return when(true);
      }
    }).catch((e) => {
      logger.error(`Failed getting watchers associated with issue ${jiraEvent.issue.key}: ` +
        `"${e.message}". Can only notify people mentioned in the description.`);
    });
  } catch (e) {
    logger.error('Caught Error in JiraEvent Issue Handler:' + e);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

function processCommentEvent(jiraEvent, framework, cb) {
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
      // Use a proxy server if configured
      if (jira_url_regexp) {
        issueUrl = issueUrl.replace(jira_url_regexp, proxy_url);
      }
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
        // Use a proxy server if configured
        let watcherUrl = watches.self;
        if (jira_url_regexp) {
          watcherUrl = watcherUrl.replace(jira_url_regexp, proxy_url);
        }
        watcherPromise = request.get(watcherUrl, jiraReqOpts);
      }

      // Add to mgs elements with issue details
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
    }).then((watcherObj) => {
      if (watcherObj) {
        watchers = watcherObj.watchers;
        watcherEmails = [];
        for (let i = 0; i < watchers.length; i++) {
          if (!toNotifyList.find((user) => user === watchers[i].name)) {
            watcherEmails.push(watchers[i].emailAddress);
          }
        }
        return when(notifyWatchers(framework, msgElements, watcherEmails, cb));
      } else {
        return when(true);
      }
    }).catch((e) => {
      logger.error(`Failed getting issue or watchers associated with ${commentUrl}: ` +
        `"${e.message}". Can only notify people mentioned in the comment.`);
    });
  } catch (e) {
    logger.error('Caught Error in JiraEvent Comment Handler:' + e);
    createTestCase(e, jiraEvent, 'caught-error');
    if (cb) {return (cb(e));}
  }
};

async function notifyMentioned(framework, msgElements, notifyList, cb) {
  if (!notifyList.length) {
    logger.verbose('No mentioned users to notify for Jira Event: ' +
      `${msgElements.subject}_${msgElements.action}. Will check for watchers...`);
    return when();
  }
  // Lookup the user details for each mention (username)
  let mentionedUserPromises = [];
  for (let i=0; i<notifyList.length; i++) {
    url = `${jira_lookup_user_api}?username=${notifyList[i]}`;
    // Use a proxy server if configured
    if (jira_url_regexp) {
      url = url.replace(jira_url_regexp, proxy_url);
    }
    mentionedUserPromises.push(request(url, jiraReqOpts));
  }
  let mentionedEmails = [];
  return when.all(mentionedUserPromises).then((users) => {
    // Convert the usernames to emails in order to associate with a bot user
    for (let i=0; i<users.length; i++) {
      mentionedEmails.push(users[i].emailAddress);
      if ((msgElements.assignedToUser) && (msgElements.assignedToUser === users[i].name)) {
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
        sendWebexNotification(theBot, recipientType,userConfig, msgElements, cb);
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
      msg = buildMentionedMessage(msgElements, bot.isDirectTo);
      break;
    case ('watcher'):
      msg = buildWatchedMessage(msgElements);
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
