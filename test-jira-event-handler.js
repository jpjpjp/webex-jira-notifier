// test-jira-event-handler.js
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// Helper classes for dealing with Jira Webhook payload
var jiraEventHandler = require("./jira-event.js");
fs = require('fs');

// Create our own verion of the bot objects that supports our test cases.
function Bot(isDirectTo) {
  this.isDirect = true;
  this.isDirectTo = isDirectTo;
  this.jiraEventMessage = '';
}
// jiraEventHandler will call bot.recall to see if the user asked to turn off notificaitons
// For testing we'll assume we always want to the notifications
Bot.prototype.recall = function(key) {
  return new Promise(function (resolve, reject) {
    if (key === 'user_config') {
      resolve({'askedExit': false});
    } else {
      reject(console.error('Test harness got unexpected bot.recall() call with key:'+key));
    }
  });
};

// jiraEventHandler will call bot.say to send a result to a Spark user
Bot.prototype.say = function(format, message) {
  // say can take one or two args.   We only care about the second for our cannonical result
  var args = Array.prototype.slice.call(arguments);
  // determine if a format is defined in arguments
  // first and second arguments should be string type
  // first argument should be one of the valid formats
  var formatDefined = (args.length > 1 && typeof args[0] === 'string' && typeof args[1] === 'string' && _.includes(['text', 'markdown', 'html'], _.toLower(args[0])));
  // if format defined in function arguments, overide default
  if(formatDefined) {
    format = _.toLower(args.shift());
  }
  // if message is object (raw)
  if(typeof args[0] === 'object') {
    this.jiraEventMessage += JSON.stringify(args[0]) + '\n';
  } else if(typeof args[0] === 'string') {
    this.jiraEventMessage += args[0] + '\n';
  } else {
    return when.reject(new Error('Invalid function arguments'));
  }
};


// Create our own verion of the flint object that supports our test cases.
function Flint() {
  this.bots=[];
}
// jiraEventHandler calls flint.debug.   We don't care about this for our tests
Flint.prototype.debug = function(message) {
  // Add a console message here if you ever want to see them.
  // console.log(message);
};
// Build the list of "bots" that we want our test suite to run against
// The current set assumes all users work for ciso
flint = new Flint();
flint.bots.push(new Bot('jshipher@cisco.com'));
flint.bots.push(new Bot('raschiff@cisco.com'));
flint.bots.push(new Bot('kboone@cisco.com'));
flint.bots.push(new Bot('lizlau@cisco.com'));
let emailOrg = 'cisco.com'


// Build the list of cannonical test objects.
function TestCase(file, action, author, subject, result) {
  this.file = file;
  this.action = action;
  this.author = author;
  this.subject = subject;
  this.result = result;
  this.resultsSeen = 0;
}
var testCases = [];
/**/
/* Quick way to test a problem issue */
// testCases.push(new TestCase('./jira-event-test-cases/1519807348530-jira:issue_updated-issue_updated.error',
//                 'error', '', '',
//                 [''], 1));
/* Specify Test Cases
/* @mention a user who is not using the bot */
//testCases.push(new TestCase('./jira-event-test-cases/comment-dorin-medash-jira:issue_updated-issue_commented.json',
//                'comments', 'dorin', 'medash', [''], 1));
/* assign an existing ticket to someone using the bot */
/* This is one of our "special users" not using a cisco email address in jira */
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-ralf-issue_updated.json',
                'assigns', 'jshipher', 'raschiff',
                ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you."}\n' +
                '{"markdown":"> Description:Please delete this later. [~jshipher]"}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* @mention multiple people who are not using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-non-bot-users-issue_commented.json',
                'comments', 'jshipher', 'nobody1 and nobody2',
                ['', ''],2));
/* @mention multiple people who are all using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-krisboone-issue_commented.json',
                'comments', 'jshipher', 'raschiff and kboone',
                ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
                '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]"}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n',
                '{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
                '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~kboone]"}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n'],2));
/* @mention multiple people only one of whom is using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-ralf-nobody1-issue_commented.json',
                'comments', 'jshipher', 'raschiff and nobody1',
                ['', '{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Hopefully the last test ticket for JP**"}\n' +
                '{"markdown":"> [~raschiff].    Thanks for your help with all my tickets today.   I\'m making a Jira Notifier bot that lets me know immediately when someone assigns a ticket to me or mentions me in the comments or description.   Let me know if you are interested in trying it. [~nobody1]"}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11576\n'], 2));
/* User using the bot assigns a ticket to themselves */                
testCases.push(new TestCase('./jira-event-test-cases/jp-assigns-jp-issue_updated.json',
                'assigns', 'jshipher', 'jshipher',
                ['{"markdown":"<br>JP Shipherd assigned existing Jira Task: **Test issue -- ignore** to you."}\n' +
                '{"markdown":"> Description:Please delete this later. [~jshipher]"}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* New comment that @mentions a user using the bot */                
// testCases.push(new TestCase('./jira-event-test-cases/jp-comments-to-jp-issue_commented.json',
//                 'comments', 'jshipher', 'jshipher',
//                 ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Bug: **Test Bug for JP**"}\n' +
//                 '{"markdown":">  Did you? Did you? [~jshipher], do you see this comment?"}\n' +
//                 'https://jira-eng-gpk2.cisco.com/jira/browse/TROPO-11565\n'], 1));
/* An updated comment @mentions a user using the bot */                
testCases.push(new TestCase('./jira-event-test-cases/jp-updates-comment-to-jp-issue_comment_edited.json',
                'comments', 'jshipher', 'jshipher',
                ['{"markdown":"<br>JP Shipherd mentioned you in the Jira Task: **Test issue -- ignore**"}\n' +
                '{"markdown":"> C\'mon [~jshipher] what are you waiting for?  Changing this to create an comment updated event."}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* A ticket is deleted that was assigned to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/liz-deletes-jps-issue_deleted.json',
                'deletes ticket', 'lizlau', 'jshipher',
                ['{"markdown":"<br>Liz Laub deleted a Jira Task: **Test Issue #2** that was assigned to you."}\n' +
                '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n'], 1));
/* User updates description of ticket mentioning a user using the bot */
testCases.push(new TestCase('./jira-event-test-cases/jp-updated-description-issue_updated.json',
                'updates description', 'jshipher', 'jshipher',
                ['{"markdown":"<br>JP Shipherd updated the description of Jira Task: **Test issue -- ignore** to you."}\n' +
                '{"markdown":"> Description:Please delete this later. [~jshipher].  Actually it looks like you will need to ask someone else to do this since you can;t."}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
                // ['{"markdown":"<br>JP Shipherd updated the description of Jira Task: **Test issue -- ignore** to you."}\n' +
                // '{"markdown":"> Description:Please delete this later. [~jshipher].  Actually it looks like you will need to ask someone else to do this since you can;t."}\n' +
                // 'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-360\n'], 1));
/* User creates a new ticket and assigns it a bot user */                
testCases.push(new TestCase('./jira-event-test-cases/jp-creates-for-ralf-issue_created.json',
                'create ticket', 'jshipher', 'raschiff',
                ['{"markdown":"<br>JP Shipherd created a Jira Task: **Test Issue #2** and assigned it to you."}\n' +
                '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n',
                '{"markdown":"<br>JP Shipherd mentioned you in a new Jira Task: **Test Issue #2**"}\n' +
                '{"markdown":"> Description:[~lizlau] will delete this soon."}\n' +
                'https://jira-eng-gpk2.cisco.com/jira/browse/SPARKPLAN-368\n'], 2));
/* Ignore a description update when no NEW text was added to the description */
testCases.push(new TestCase('./jira-event-test-cases/eivhaarr-removes-text-from-description-issue_updated.json',
                'updates', 'eivhaarr', 'pmadai',
                [''], 1));


// Run the Tests
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}

// This no longer works because it depends on each test completing before the next one starts
// The new processJiraEvent does not complete the call to bot.say before the next test starts
for (var i = 0, len = testCases.length; i < len; i++) {
  test = testCases[i];
  //var jiraEvent = require(test.file);
  var jiraEvent = JSON.parse(fs.readFileSync(test.file, "utf8"))
  jiraEventHandler.processJiraEvent(jiraEvent, flint, emailOrg, checkTestResult(flint, test, i+1));
}

function checkTestResult(flint, test, testNum) {
  return function jiraEventCallback(err, bot=null) {
    test.resultsSeen += 1;
    if (err) {
      console.log('Test %d Failed.', testNum);
      if (verbose) {
        console.log('Got error in callback:'+err.message);
        console.log('Expected\n' + test.result[test.resultsSeen-1]);
      }
      return;
    }
    if (!bot) {
      if (test.result[test.resultsSeen-1]) {
        console.log('Test %d Failed.', testNum);
      } else {
        console.log('Test %d Passed.', testNum);
      }
      if (verbose) {
        console.log('jiraEventHander did not callback with a bot.');
        console.log('Expected\n' + test.result[test.resultsSeen-1]);
      }
      return;
    }
    if (verbose) {
      console.log('Checking test file:' + test.file);
      console.log(test.author + ' ' + test.action + ' to ' + test.subject + '...');
    }
    var resultFound = false;
    if (bot.jiraEventMessage) {
      resultFound = true;
      // Whitespace got me down, just removed it for this comparison
      if (bot.jiraEventMessage.replace(/\s/g, '') === test.result[test.resultsSeen-1].replace(/\s/g, '')) {
         console.log('Test %d Passed.', testNum);
         //console.log(bot.jiraEventMessage);
      } else {
       console.log('Test %d Failed.', testNum);
       if (verbose) {
         console.log('Got\n' + bot.jiraEventMessage + 'Expected\n' + test.result[test.resultsSeen-1]);
       }
      }
       bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        console.log('Test %d Passed.', testNum);
      } else {
        console.log('Test %d Failed.', testNum);
        if (verbose) {
          console.log('Got no result');
          console.log('Expected\n' + test.result[test.resultsSeen-1]);
        }
      }
    }
  };
}

