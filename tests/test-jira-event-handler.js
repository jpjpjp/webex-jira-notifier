// test-jira-event-handler.js
// Run some prepared jira event through the handler to ensure
// that we get our expected results
/*jshint esversion: 6 */  // Help out our linter

// Helper classes for dealing with Jira Webhook payload
require('dotenv').config();
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

// Build the list of "bots" that we want our test suite to run against
// The current set assumes all users work for ciso
let Framework = require('./test-framework');
framework = new Framework();
jiraTestCases.initBotUsers(framework, test_dir);

var testCases = [];
jiraTestCases.initTestCases(testCases, test_dir, jiraConnector.getJiraUrl());

// Set VERBOSE=true to get test logging
var verbose = false;
if (process.env.VERBOSE) {
  verbose = true;
}

// Finally, load and initialize the class that will run each jira event based test
let ProcessJiraTestCases = require('./process-jira-test-cases');
let processJiraTests = new ProcessJiraTestCases(verbose);
processJiraTests.runTests(testCases, jiraEventHandler, framework); 


// // This no longer works because it depends on each test completing before the next one starts
// // The new processJiraEvent does not complete the call to bot.say before the next test starts
// let expectedCallbacks = 0;
// for (var i = 0, len = testCases.length; i < len; i++) {
//   test = testCases[i];
//   expectedCallbacks += test.numExpectedResults;
//   //var jiraEvent = require(test.file);
//   var jiraEvent = JSON.parse(fs.readFileSync(`${test.file}`, "utf8"));
//   jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, test, i + 1));
// }

