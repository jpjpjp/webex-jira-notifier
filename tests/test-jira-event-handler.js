// test-jira-event-handler.js
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// Helper classes for dealing with Jira Webhook payload
const JiraConnector = require('../jira-connector');
const jiraConnector = new JiraConnector();
const JiraEventHandler = require("../jira-event.js");
const jiraEventHandler = new JiraEventHandler(jiraConnector);
fs = require('fs');

if (!process.env.TEST_CASE_DIR) {
  console.error('The environment variable TEST_CASE_DIR must be specified.');
  process.exit(-1);
}
const test_dir = process.env.TEST_CASE_DIR;

const JiraTestCases = require(`../${test_dir}/init-test-cases.js`);
const jiraTestCases = new JiraTestCases;



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
jiraTestCases.initBotUsers(framework, test_dir);

var testCases = [];
jiraTestCases.initTestCases(testCases, test_dir, jiraConnector.getJiraUrl());

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
  var jiraEvent = JSON.parse(fs.readFileSync(`${test.file}`, "utf8"));
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
        console.log(result);
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
        showExpected('jiraEventHander did not find a bot for an intended recipent' +
          ', but our expected results do not include an empty response.', test);
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
  console.error(`While processing test input: ${test.file}`);
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
