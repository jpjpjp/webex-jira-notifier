// jira-connector.js
//
// An object for interacting with the Jira system
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();
request = require('request-promise');
logger = require('./logger');

// Helper classes for dealing with Jira Webhook payload
//var jiraEventHandler = require("./jira-event.js");


class JiraConnector {
  constructor() {
    try {
      // Jira login configuration
      this.jira_user = process.env.JIRA_USER;
      this.jira_pw = process.env.JIRA_PW;
      this.jira_auth = 'Basic ' + Buffer.from(this.jira_user + ':' + this.jira_pw).toString('base64');
      this.jira_url = process.env.JIRA_URL;

      // Optional support for a proxy to access jira system behind a firewall
      if (process.env.PROXY_URL) {
        this.jira_url_regexp = new RegExp(this.jira_url);
        this.proxy_url = process.env.PROXY_URL;
        logger.info('Will attempt to access Jira via proxy at ' + this.proxy_url);
      } else {
        this.jira_url_regexp = null;
        this.proxy_url = null;
      }

      // Default jira query request options
      this.defaultOptions = {
        "method": 'POST',
        "json": true,
        headers: {
          // We'll use Basic Auth for most operations
          'Authorization': this.jira_auth,
          // If I ever switch to OAuth
          //'bearer' : bearerToken

          'Content-Type': 'application/json'
        },
        body: {
          // TODO implment pagination
          "maxResults": 500
        },
      };
      if (this.proxy_url) {
        this.defaultOptions.uri = this.proxy_url + '/rest/api/2/search';
      } else {
        this.defaultOptions.uri = this.jira_url + '/rest/api/2/search';
      }

    } catch (err) {
      logger.error('Cannot read Jira config from environment: ' + err.message);
      throw (err);
    }
  }

  /**
   * Accessor for default request options
   *
   * @function getDefaultOptions
   */
  getDefaultOptions() {
    return this.defaultOptions;
  }

  /**
   * Accessor for default request options for a PUT
   * For some reason PATCH requries username and password
   * instead of an Authorization header
   *
   * @function getDefaultOptions
   */
  getDefaultPutOptions() {
    let options = JSON.parse(JSON.stringify(this.defaultOptions));
    options.method = 'PUT';
    // delete options.headers.Authorization;
    // options.headers.userid = this.jira_user;
    // options.headers.password = this.jira_pw;

    return options;
  }

  /**
   * Lookup user to see if they have a jira account
   *
   * @function lookupUser
   * @param {object} user - email or username to lookup
   */
  lookupUser(user) {
    let self = this;
    return new Promise(function (resolve, reject) {
      let options = JSON.parse(JSON.stringify(self.defaultOptions));
      options.method = 'GET';
      options.uri = self.proxy_url ? self.proxy_url : self.jira_url;
      options.uri += self.user_url;
      options.qs = {
        "username": user
      };
      request(options).then(resp => {
        if ((!Array.isArray(resp)) || (!resp.length)) {
          reject(new Error('Could not determine if ' + user + ' is a member of our jira team.'));
        }
        resolve(resp);
      }).catch(err => {
        logger.error('Failed to lookup jira user: ' + user + ', ' + err.message);
        reject(new Error('Could not determine if ' + user + ' is a member of our jira team.'));
      });
    });
  }

  /**
   * Perform JQL query based on keys
   *
   * @function lookupByKey
   * @param {object} callerName - Log info about the user or space requesting this
   * @param {array} keys - array of jira key names to fetch
   */
  lookupByKey(callerName, keys) {
    let self = this;
    return new Promise(function (resolve, reject) {
      let options = JSON.parse(JSON.stringify(self.defaultOptions));
      options.body = {"jql": ""};
      options.body.jql = 'key in (' + keys.map(x => '\"' + x + '\"').join(',') + ')';
      request(options).then(resp => {
        if (!resp.hasOwnProperty('issues')) {
          reject(new Error('Did not get expected response from Jira watcher lookup. ' +
            'This usually happens due to login failure and redirection.'));
        }
        logger.debug('lookupByKey method found ' + resp.issues.length + ' issues ' +
          'for query filter: ' + options.body.jql +
          ' Requested by user:' + callerName);
        resolve(resp.issues);
      }).catch(err => {
        reject(err);
      });
    });
  }

  /**
   * Add a comment to a jira base on its API url
   *
   * @function addComment
   * @param {string} uri - uri of the jira to update
   * @param {string} key - jira issue key to comment on
   * @param {string} comment - comment to enter
   * @param {object} bot - bot that user asked to comment
   * @param {string} email - email of user comment is submitted on behalf of
   */
  async addComment(uri, key, comment, bot, email) {
    let fullComment = `${comment}\n\nPosted by ${bot.person.displayName} on behalf of [~${email.split('@', 1)[0]}]`;
    let options = this.getDefaultPutOptions();
    delete options.uri;
    options.url = uri;
    options.body = {
      "update": {
        "comment": [
          {
            "add": {
              "body": fullComment
            }
          }
        ]
      }
    };
    request(options).then((resp) => {
      // Add logic to check for a 204?
      logger.debug(`Posted a comment to jira issue ${key} on behalf of ${email}`);
    }).catch(e => {
      logger.warn(`Failed to post comment for ${email}: ${e.message}`);
      bot.say('Sorry, failed to post your comment. ' +
        'Please click the link above and update directly in jira.');
    });
  }

  /**
   * Add a comment to a jira base on its API url
   *
   * @function postCommentToParent
   * @param {object} bot - bot that user asked to comment
   * @param {object} trigger - trigger object with info on user message and details
   */
  async postCommentToParent(bot, trigger) {
    let userEmail = trigger.person.emails[0];
    let issueKey = '';
    let errMsg = 'Cannot find the an issue to comment on. ' +
      'Please click the link above and update directly in jira.';
    if (!trigger.message.parentId) {
      logger.warn(`In postCommentToParent but message from ${userEmail}is not a reply`);
      return bot.reply(trigger.message, errMsg);
    }
    // Fetch the parent message to see if we can get the issue key
    bot.webex.messages.get(trigger.message.parentId).then((message) => {
      if (message.personId !== bot.person.id) {
        throw new Error(`In postCommentToParent but parent of message from ${userEmail} was not posted by the bot.`);
      }
      // TODO clean up this regexp -- its too loose...
      let keys = message.text.match(/([^/]*)$/);
      if (!keys || !keys.length) {
        throw new Error(`In postCommentToParent due to request from ${userEmail}, but unable to find issue key in parent message.`);
      }
      issueKey = keys[0];
      return this.lookupByKey(trigger.person.emails[0], [issueKey]);
    }).then((issues) => {
      if (!issues || !(issues.length) || !(issues[0].self)) {
        throw new Error(`In postCommentToParent failed to find jira issue with ${issueKey}`);
      }
      return this.addComment(issues[0].self, issues[0].key, trigger.message.text, bot, userEmail);
    }).catch((e) => {
      logger.warn(e.message);
      return bot.reply(trigger.message, errMsg);
    });
  }

}

module.exports = JiraConnector;
