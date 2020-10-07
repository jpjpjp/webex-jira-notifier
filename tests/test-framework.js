// test-framework.js

// Create our own verion of the Framework object that supports our test cases.
exports.Framework = class{
  constructor(config){
    this.config = config;
    this.bots = [];
  }

  // jiraEventHandler calls framework.debug.   We don't care about this for our tests
  debug(message) {
    if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('framework'))) {
      console.log(message);
    }
  }
};

 
// Define the object we use to run our jira event test cases
exports.TestCase = function (file, action, author, subject, result) {
  this.file = file;
  this.action = action;
  this.author = author;
  this.subject = subject;
  this.result = result;
  this.resultsSeen = 0;
  this.numExpectedResults = result.length;
  this.numPassed = 0;
  this.numSeenErrors = 0;
};

