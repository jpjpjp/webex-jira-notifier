// test-framework.js

// Create our own verion of the Framework object that supports our test cases.
class Framework {
  constructor(config){
    this.config = config;
    this.bots = [];
  }

  // jiraEventHandler calls framework.debug.   We don't care about this for our tests
  debug = function (message) {
    if ((process.env.DEBUG) && (process.env.DEBUG.toLowerCase().substring('framework'))) {
      myConsole.log(message);
    }
  }
}

module.exports = Framework;
