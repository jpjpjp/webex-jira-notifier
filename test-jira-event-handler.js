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
// For testing we'll assume we always want to get the notifications
Bot.prototype.recall = function (key) {
  let bot = this;
  return new Promise(function (resolve, reject) {
    if (key === 'userConfig') {
      if (bot.isDirectTo == 'jshipher@cisco.com') {
        resolve({'askedExit': false, 'notifySelf': true});
      } else {
        resolve({'askedExit': false});
      }
    } else {
      let msg = 'Test harness got unexpected bot.recall() call with key:' + key;
      console.error(msg);
      reject(new Error(msg));
    }
  });
};

// jiraEventHandler will call bot.store to save info about the last notification
// This is not currently used in the tests
Bot.prototype.store = function () {
  return new Promise(function (resolve) {
    resolve(true);
  });
};


// jiraEventHandler will call bot.say to send a result to a Spark user
Bot.prototype.say = function () {
  // say can take one or two args.   We only care about the second for our cannonical result
  var args = Array.prototype.slice.call(arguments);
  // determine if a format is defined in arguments
  // first and second arguments should be string type
  // first argument should be one of the valid formats
  var formatDefined = (args.length > 1 && typeof args[0] === 'string' && typeof args[1] === 'string' && _.includes(['text', 'markdown', 'html'], _.toLower(args[0])));
  // if format defined in function arguments, overide default
  if (formatDefined) {
    format = _.toLower(args.shift());
  }
  // if message is object (raw)
  if (typeof args[0] === 'object') {
    this.jiraEventMessage += JSON.stringify(args[0]) + '\n';
  } else if (typeof args[0] === 'string') {
    this.jiraEventMessage += args[0] + '\n';
  } else {
    return when.reject(new Error('Invalid function arguments'));
  }
};


// Create our own verion of the Framework object that supports our test cases.
function Framework() {
  this.bots = [];
}
// jiraEventHandler calls framework.debug.   We don't care about this for our tests
Framework.prototype.debug = function (message) {
  if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('framework'))) {
    console.log(message);
  }
};
// Build the list of "bots" that we want our test suite to run against
// The current set assumes all users work for ciso
framework = new Framework();
framework.bots.push(new Bot('jshipher@cisco.com'));
framework.bots.push(new Bot('atlassian-adm@cisco.com'));
framework.bots.push(new Bot('dmarsico@cisco.com'));


// Build the list of cannonical test objects.
function TestCase(file, action, author, subject, result) {
  this.file = file;
  this.action = action;
  this.author = author;
  this.subject = subject;
  this.result = result;
  this.resultsSeen = 0;
  this.numExpectedResults = result.length;
  this.numPassed = 0;
  this.numSeenErrors = 0;
}
var testCases = [];
/**/
/* Quick way to test a problem issue */
// /* A new ticket is created that mentions a bot user */
// testCases.push(new TestCase('./jira-event-test-cases/issue_created_mention_bot_user.json',
//   'creates an issue', 'jshipher', 'and mentions bot user',
//   [
//     `{"markdown":"You were mentioned in a Jira Story created by JP Shipherd: **Test Story**.\\n\\nThis is a story<br />The summary mentions a user [~jshipher]\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
//   ]));

/* 
 *  This is the full set of test cases
 */

/* A new ticket is created that mentions a bot user */
testCases.push(new TestCase('./jira-event-test-cases/issue_created_mention_bot_user.json',
  'creates an issue', 'jshipher', 'and mentions bot user',
  [
    `{"markdown":"You were mentioned in a Jira Story created by JP Shipherd: **Test Story**.\\n\\nThis is a story<br />The summary mentions a user [~jshipher]\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
  ]));

/* An issue is assigned to a bot user */
testCases.push(new TestCase('./jira-event-test-cases/issue_updated_assign_bot_user.json',
  'assigned', 'jshipher', 'to abot user',
  [
    `{"markdown":"You were assigned to a Jira Story by JP Shipherd: **Test Story**.\\n\\nThis is a story<br />The summary mentions a user [~jshipher]\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`,
  ]));

/* An issue's status is changed */
testCases.push(new TestCase('./jira-event-test-cases/issue_updated_change_status.json',
  'updated the status', 'jshipher', '',
  [
    `{"markdown":"JP Shipherd changed the status to \\"In Progress\\" for Jira Story: **Test Story** that you are assigned to.\\n\\nThis is a story<br />The summary mentions a user [~jshipher]\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
  ]));

/* An issue is created and assigned */
testCases.push(new TestCase('./jira-event-test-cases/issue_created_and_assigned.json',
  'created', 'jshipher', 'and assigned to a bot user',
  [
    `{"markdown":"JP Shipherd assigned JIRA Admin to a Jira Epic you are mentioned in: **Test Epic 2 -- ignore**.\\n\\nThis is (hopefully the last) test epic you will be assigned by [~jshipher]. <br />Please disregard and apologies for the noise.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-41"}`,
    `{"markdown":"You were assigned to a Jira Epic by JP Shipherd: **Test Epic 2 -- ignore**.\\n\\nThis is (hopefully the last) test epic you will be assigned by [~jshipher]. <br />Please disregard and apologies for the noise.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-41"}`
  ]));
 
/* A ticket assigned to jp with watchers gets a new multiline comment and no one is mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_created_multiline.json',
  'comments', 'jshipher', 'without any mentions',
  [
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a new comment that<br />Spans multiple lines<br />The end.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a new comment that<br />Spans multiple lines<br />The end.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets an updated comment (without any mentions) */
testCases.push(new TestCase('./jira-event-test-cases/comment_updated_multiline.json',
  'updates a commment', 'jshipher', 'without any mentions',
  [
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is an edited comment that<br />Spans multiple lines<br />The end.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is an edited comment that<br />Spans multiple lines<br />The end.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets a new comment with a watcher mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_created_mention_watcher.json',
  'comments and', 'jshipher', 'mentions a watcher',
  [
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment with a mention of someone who is also a watcher [~jshipher].  \\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment with a mention of someone who is also a watcher [~jshipher].  \\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets an updated comment with a watcher mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_updated_mention_watcher.json',
  'updates a commment', 'jshipher', 'and mentions a watcher',
  [
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment with a mention of someone who is also a watcher [~jshipher].  (Edit -- feel free to ignore)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment with a mention of someone who is also a watcher [~jshipher].  (Edit -- feel free to ignore)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets a new comment with a non watcher bot user mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_created_mention_non_watcher_bot_user.json',
  'comments', 'jshipher', 'and mentions a non watcher bot user',
  [
    `{"markdown":"You were mentioned in a comment created by JP Shipherd on a Jira Task: **testing 1 2 3**.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  \\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  \\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  \\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets an updated comment with a watcher mentioned */
// // This test uses a non-existing user.  May need to get rid of it.
testCases.push(new TestCase('./jira-event-test-cases/comment_updated_mention_non_watcher_bot_user.json',
  'updates a commment', 'jshipher', 'and mentions a non watcher bot user',
  [
    `{"markdown":"You were mentioned in a comment updated by JP Shipherd on a Jira Task: **testing 1 2 3**.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  (Edit -- feel free to ignore)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  (Edit -- feel free to ignore)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment with a mention of someone who is also a watcher [~dmarsico].  (Edit -- feel free to ignore)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets a new comment with a non watcher non bot user mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_created_mention_nonwatcher.json',
  'comments', 'jshipher', 'and mentions a non watcher non bot user',
  [
    ``,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment that mentions [~ahughley], who is not a watcher.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd created a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment that mentions [~ahughley], who is not a watcher.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));

/* A ticket assigned to jp with watchers gets an updated comment with a non watcher non bot user mentioned */
testCases.push(new TestCase('./jira-event-test-cases/comment_updated_mention_nonwatcher.json',
  'updates a commment', 'jshipher', 'and mentions a non watcher non bot user',
  [
    ``,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are assigned to.\\n\\nThis is a comment that mentions [~ahughley], who is not a watcher. Please feel free to ignore.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`,
    `{"markdown":"JP Shipherd updated a comment on a Jira Task: **testing 1 2 3** that you are watching.\\n\\nThis is a comment that mentions [~ahughley], who is not a watcher. Please feel free to ignore.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-38"}`
  ]));
  
/* A ticket assigned to jp' summary is updated and all mentions are removed */
testCases.push(new TestCase('./jira-event-test-cases/issue_updated_summary_changed_mention_bot_user_non_watcher.json',
  'updates an issue', 'jshipher', 'and removes mentions',
  [
    `{"markdown":"JP Shipherd updated a Jira Story: **Test Story** that you are assigned to.\\n\\nThis is a story<br />The summary update removes all mentioned users.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
  ]));
  
/* A ticket assigned to jp's summary is updated mentions are removed */
testCases.push(new TestCase('./jira-event-test-cases/issue_updated_summary_changed_removes_mentions.json',
  'updates an issue', 'jshipher', 'and removes mentions',
  [
    `{"markdown":"JP Shipherd updated a Jira Story: **Test Story** that you are assigned to.\\n\\nThis is a story<br />The summary update removes all mentioned users.\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
  ]));
  
/* A ticket assigned to jp's summary is updated and a mention is added */
testCases.push(new TestCase('./jira-event-test-cases/issue_updated_summary_changed_with_new_mention.json',
  'updates an issue', 'jshipher', 'adds a mention',
  [
    ``,
    `{"markdown":"JP Shipherd updated a Jira Story: **Test Story** that you are assigned to.\\n\\nThis is a story<br />The summary mentions a user [~jshipher]<br />This summary update mentions another user [~alexjoh] (please disregard any notifications.   This is just a test)\\n\\nhttps://jira-dev-gpk3.cisco.com/jira/browse/ETP-39"}`
  ]));
  

// Run the Tests
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}

// This no longer works because it depends on each test completing before the next one starts
// The new processJiraEvent does not complete the call to bot.say before the next test starts
let expectedCallbacks = 0;
for (var i = 0, len = testCases.length; i < len; i++) {
  test = testCases[i];
  expectedCallbacks += test.numExpectedResults;
  //var jiraEvent = require(test.file);
  var jiraEvent = JSON.parse(fs.readFileSync(test.file, "utf8"));
  jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, test, i + 1));
}

// Set a timer to interrupt any long running tests.  Check which tests didn't get back expected results
let timerDuration = expectedCallbacks * 1000;  // Allow 1 seconds per callback (or use environment)
if (process.env.TEST_TIMER_MULTIPLIER) {
  timerDuration = expectedCallbacks * parseInt(process.env.TEST_TIMER_MULTIPLIER);
}
console.log(`Running ${testCases.length} tests expected to generate ${expectedCallbacks} responses.`);
console.log(`Set environment VERBOSE=true for more details.`);
console.log(`Will analyze results in ${timerDuration / 1000} seconds...`); 
setTimeout(() => {
  let totalErrors = 0;
  let totalPassed = 0;
  for (var i = 0, len = testCases.length; i < len; i++) {
    test = testCases[i];
    totalErrors += test.numSeenErrors;
    totalPassed += test.numPassed;
    if ((test.result.length) && (test.result.length != test.numSeenErrors)) {
      for (result of test.result) {
        console.log(`Test ${i+1}: ${test.author} ${test.action} `+ 
          `${test.subject}, based on file: ${test.file}, never got expected result:`);
        console.error(result);
        totalErrors += 1;
      } 
    }
  }

  console.log(`\nAll tests complete. ${totalPassed} tests passed.`);
  if (totalErrors) {
    console.error(`Number of errors seen: ${totalErrors}`);
  }
  process.exit();
}, timerDuration);

// Jira Event will call us back with the message that a bot sent
// Check to see if matches our expected result
function checkTestResult(framework, test, testNum) {
  return function jiraEventCallback(err, bot = null) {
    test.resultsSeen += 1;
    if (verbose) {
      console.log(`Checking a result for test ${testNum}: ${test.author} ` +
        `${test.action} ${test.subject}, based on file: ${test.file}`);
    }

    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum, test.numExpectedResults);
      showExpected(`Got error in callback: ${err.message}`, test);
      return;
    }

    //TODO figure out how to properly deal with this -- we got more results than expected!
    if (!test.result.length) {
      let seenResult = (bot) ? bot.jiraEventMessage : '';
      console.error(`Already got all ${test.numExpectedResults} expected results for test `
        `${testNum}. Extra result is: "${seenResult}"`);
      test.numSeenErrors++;
      return;
    }

    if (!bot) {
      if (foundResult('', test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected non-notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('jiraEventHander did not callback with a bot.', test);
      }
      return;
    }

    var resultFound = false;
    if (bot.jiraEventMessage) {
      resultFound = true;
      // Whitespace got me down, just removed it for this comparison
      if (foundResult(bot.jiraEventMessage, test)) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.  ` +
          'Got expected notification');
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected(`Got\n${bot.jiraEventMessage}`, test);
      }
      bot.jiraEventMessage = '';
    }
    if (!resultFound) {
      if (!test.result) {
        reportSuccess(test, 
          `Test ${testNum} (Result ${test.resultsSeen} of ${test.numExpectedResults}) Passed.`);
      } else {
        console.error('Test %d (Result %d of %d) Failed.', testNum, test.resultsSeen, test.numExpectedResults);
        showExpected('Got no result', test);
      }
    }
  };
}


// Check the bot message against the set of valid results
// We need to look at all possible values because the order of 
// messages is not predictable since we are waiting on various
// jira API calls to give us info about mentioned or watching users
function foundResult(botMessage, test) {
  for (let i=0; i<test.result.length; i++) {
    // Strip whitespace to simply comparison
    if (botMessage.replace(/\s/g, '') === test.result[i].replace(/\s/g, '')) {
      // Remove this result from the set of expected result
      test.result.splice(i, 1);
      return true;
    }
  }
  return false;
}

// Function to display progress info
function reportSuccess(test, msg) {
  test.numPassed++;
  if (verbose) { 
    console.log(msg); 
  }
}


// Function to display the expected results when a test fails
function showExpected(msg, test) {
  test.numSeenErrors += 1;
  console.error(msg);
  if (test.result.length == 1) {
    console.error('Expected\n' + test.result[0]);
  } else {
    console.error('Expected one of:');
    for(let i=0; i<test.result.length; i++) {
      console.error(`${test.result[i]}`);
    }
  }
}
