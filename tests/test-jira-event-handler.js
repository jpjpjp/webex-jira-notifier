// test-jira-event-handler.js
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

require('dotenv').config();
if (!process.env.TEST_CASE_DIR) {
  console.error('The environment variable TEST_CASE_DIR must be specified.');
  process.exit(-1);
}

// Ensure that the directory where the canned Jira Events are exists
let test_dir;
try {
  test_dir = path.resolve(process.env.TEST_CASE_DIR);
} catch(e) {
  console.error(`Unable to resolve TEST_CASE_DIR: ${process.env.TEST_CASE_DIR}`);
  process.exit();
}

// Load in the jira modules that we are testing
const JiraConnector = require('../jira-connector');
const jiraConnector = new JiraConnector();
const JiraEventHandler = require("../jira-event.js");
const jiraEventHandler = new JiraEventHandler(jiraConnector);
fs = require('fs');


// Set VERBOSE=true to get test logging
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}

// Read in our pretend "Framework", and our TestCase object
let {Framework, TestCase} = require('./test-framework');
framework = new Framework();

// Read in the configuration for our tests
// See user-notification-test-config-template.js for more info
let {testConfig} = require(`./user-notification-test-config`);

// Create some "bots" for our tests
let Bot = require('./test-bot');
if (testConfig?.botsUnderTest?.length) {
  testConfig.botsUnderTest.forEach((test) => {
    framework.bots.push(new Bot(test.email, verbose, true /*isDirect*/, test.config));
  });  
} else {
  console.error('At least one botToTest must be specified in transition-test-config');
  process.exit();
}

// Configure the "notification test cases" which will emulate
// jira-events occuring which may trigger notifications in one of
// our "Webex spaces" that are configured to watch boards with it
var testCases;
if (testConfig?.testCases?.length) {
  testCases = readNotifyTestCasesFromConfig(testConfig.testCases);
} else {
  console.error('At least one firstPassTestCases must be specified in transition-test-config');
  process.exit();
}


// Finally, load and initialize the class that will run each jira event based test
let ProcessJiraTestCases = require('./process-jira-test-cases');
let processJiraTests = new ProcessJiraTestCases(verbose);
processJiraTests.runTests(testCases, jiraEventHandler, framework); 


// helper to build test cases from config
function readNotifyTestCasesFromConfig(testCasesConfig) {
  let testCases = [];
  testCasesConfig.forEach((test) => {
      testCases.push(new TestCase(
        `${test_dir}/${test.eventData}`,
        test.userAction, test.user, test.userTarget,
        test.expectedNotifications)); 
  });
  return testCases;
}


