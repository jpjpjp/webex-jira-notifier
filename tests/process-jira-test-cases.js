
/**
 * This class is shared by the test frameworks that test that our bot properly
 * notifies 1-1 or group spaces based on certain jira events
 */

path = require('path');

// Output based on the verbose flag sent into our constructor
var myConsole = {};
let verbose = false;
myConsole.log = function(msg) {
  if (verbose) {console.log(msg);}
}; 

class ProcessJiraTestCases {
  constructor(verboseFlag) {
    verbose = verboseFlag;
  }
  /*   
  * This driver reads an array of jira-event based test cases and sends
  * then the processJiraEvent method in our jira handler.   A callback
  * method is passed to the jira handler.  This callback is called whenever
  * the handler sends a notification to a bot (or determines that watchers
  * associated with the issue, should NOT get a notification).   The 
  * callback method compares the (non)-notification with the list of expected
  * results, removing the expected result from the queue whenever a match is found
  * 
  * For each expected result in each test case the driver will wait an additional 
  * second before determining that no more events are coming and generate error
  * messages indicating that some expected notifications never came.
  * 
  */
  runTests(testCases, jiraEventHandler, framework) {
    // Loop through the test cases to and send each one to the event processor
    let expectedCallbacks = 0;
    for (var i = 0, len = testCases.length; i < len; i++) {
      let test = testCases[i];
      expectedCallbacks += test.numExpectedResults;
      var jiraEvent = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), test.file), "utf8"));
      jiraEventHandler.processJiraEvent(jiraEvent, framework, checkTestResult(framework, test, i + 1));
    }

    // Set a timer to determine when to check if we missed any of the expected callbacks
    let timerDuration = expectedCallbacks * 1000;  // Allow 1 seconds per callback (or use environment)
    if (process.env.TEST_TIMER_MULTIPLIER) {
      timerDuration = expectedCallbacks * parseInt(process.env.TEST_TIMER_MULTIPLIER);
    }
    myConsole.log(`Running ${testCases.length} tests expected to generate ${expectedCallbacks} responses.`);
    myConsole.log(`Set environment VERBOSE=true for more details.`);
    myConsole.log(`Will analyze results in ${timerDuration / 1000} seconds...`); 
    // TODO -- modify this so it doesn't return until the promise gets
    // resolved in the timeout handler
    return new Promise((r) => returnAfterTimeout(r, testCases, timerDuration));
  }

}
 
module.exports = ProcessJiraTestCases;

/**
  * 
  * Helper methods use by this class
  */

// Report test results after our timer expires
function returnAfterTimeout(resolveMethod, testCases, timerDuration) {
  setTimeout(() => {
    let totalErrors = 0;
    let totalPassed = 0;
    for (var i = 0, len = testCases.length; i < len; i++) {
      test = testCases[i];
      totalErrors += test.numSeenErrors;
      totalPassed += test.numPassed;
      if ((test.result.length) && (test.result.length != test.numSeenErrors)) {
        for (result of test.result) {
          console.error(`Test ${i+1}: ${test.author} ${test.action} `+ 
            `${test.subject}, based on file: ${test.file}, never got expected result:`);
          console.error(result);
          totalErrors += 1;
        } 
      }
    }

    myConsole.log(`\nAll tests complete. ${totalPassed} tests passed.`);
    if (totalErrors) {
      console.error(`Number of errors seen: ${totalErrors}`);
    }
    resolveMethod();
  }, timerDuration);
};

// Jira event processor will call us back with the message that a bot sent
// Check to see if matches our expected result
function checkTestResult(framework, test, testNum) {
  return function jiraEventCallback(err, bot = null) {
    test.resultsSeen += 1;
    if (verbose) {
      myConsole.log(`Checking a result for test ${testNum}: ${test.author} ` +
        `${test.action} ${test.subject}, based on file: ${test.file}`);
    }

    if (err) {
      console.error('Test %d (Result %d of %d) Failed.', testNum, test.numExpectedResults);
      showExpected(`Got error in callback: ${err.message}`, test);
      return;
    }

    // Error if we got more results than expected.
    if (!test.result.length) {
      let seenResult = (bot) ? bot.jiraEventMessage : '';
      console.error(`Already got all ${test.numExpectedResults} expected results for test `
        `${testNum}. Extra result is: "${seenResult}"`);
      test.numSeenErrors++;
      return;
    }

    // No bot object means event processor found a user who could be notified
    // but they do not have not registered a space with the bot
    // (Configure users who have bots in init-test-cases.js in the TEST_CASE_DIR)
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

    // Compare result that bot "sent" is in the list of expected results in the test case
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
    myConsole.log(msg); 
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

