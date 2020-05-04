// jira-connector.js
//
// An object for interacting with the Jira system
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
require('dotenv').config();
const when = require('when');
const request = require('request-promise');
const logger = require('./logger');


class JiraConnector {
  // TODO modify constructor so logger can be passed in as an optional
  // param which defaults to console logging
  constructor() {
    try {
      // Configure Access to Jira to find watcher and other info
      this.request = null;
      this.jira_url = '';
      this.jira_lookup_user_api = '';
      this.proxy_url = '';
      this.jira_url_regexp = null;
      //this.jiraProjects = null;
      this.jiraReqOpts = {
        "json": true,
        method: 'GET',
        headers: {
          'Authorization': 'Basic '
        }
      };

      // Set up Authorization header
      if ((process.env.JIRA_USER) && (process.env.JIRA_PW)) {
        this.request = request;
        this.jiraReqOpts.headers.Authorization +=
          new Buffer.from(process.env.JIRA_USER + ':' +
            process.env.JIRA_PW).toString('base64');

        if (process.env.JIRA_URL) {
          this.jira_url = process.env.JIRA_URL;
          // Set variables to get access jira via proxy
          if (process.env.PROXY_URL) {
            this.jira_url_regexp = new RegExp(this.jira_url);
            this.proxy_url = process.env.PROXY_URL;
            logger.info('Will attempt to access Jira at ' + this.proxy_url +
              'in order in order to proxy requests to ' + this.jira_url);
          }
        } else {
          console.error(`Missing environment varialbe JIRA_URL.  Messages will not contain links to stories.`);
        }

        // Check if our bot is only allowed to access specified jira projects
        if (process.env.JIRA_PROJECTS) {
          this.jiraProjects = process.env.JIRA_PROJECTS.split(',');
        }

        // Check if our environment overrode the lookup by username path
        if (process.env.JIRA_LOOKUP_USER_API) {
          this.jira_lookup_user_api = JIRA_LOOKUP_USER_API;
        } else {
          this.jira_lookup_user_api = `${this.jira_url}/rest/api/2/user`;
        }
        // Check if our environment overrode the lookup by username path
        if (process.env.JIRA_LOOKUP_ISSUE_API) {
          this.jira_lookup_issue_api = JIRA_LOOKUP_ISSUE_API;
        } else {
          this.jira_lookup_issue_api = `${this.jira_url}/rest/api/2/search`;
        }

        // Build an in-memory cache of jira users as we look them up
        this.jiraUserCache = [];

      } else {
        logger.error('Cannot read Jira credential.  Will not notify watchers');
      }
    } catch (err) {
      logger.error('Cannot read Jira config from environment: ' + err.message);
      throw (err);
    }
  }

  /**
   * Accessor for main jira url
   *
   * @function getJiraUrl
   */
  getJiraUrl() {
    return this.jira_url;
  }

  /**
   * Accessor for default request options
   *
   * @function getDefaultOptions
   */
  getDefaultOptions() {
    return this.jiraReqOpts;
  }

  /**
   * Accessor for default request options for a PUT
   * For some reason PATCH requries username and password
   * instead of an Authorization header
   *
   * @function getDefaultOptions
   */
  getDefaultPutOptions() {
    let options = JSON.parse(JSON.stringify(this.jiraReqOpts));
    options.method = 'PUT';
    options.headers['Content-Type'] = 'application/json';
    return options;
  }

  /**
   * Accessor for default request options for a PUT
   * For some reason PATCH requries username and password
   * instead of an Authorization header
   *
   * @function getDefaultOptions
   */
  getDefaultPostOptions() {
    let options = JSON.parse(JSON.stringify(this.jiraReqOpts));
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    return options;
  }

  /**
   * Convert url to use proxy if configured
   *
   * @function convertForProxy
   * @param {object} url - url to translate
   */
  convertForProxy(url) {
    if (this.jira_url_regexp) {
      url = url.replace(this.jira_url_regexp, this.proxy_url);
    }
    return url;
  }

  /**
   * Lookup user to see if they have a jira account
   *
   * @function lookupUser
   * @param {object} user - email or username to lookup
   * @returns {Promise.<user>} - a single jira user object
   */
  lookupUser(user) {
    // Check our local cache first
    let userObj = this.jiraUserCache.find((u) => (user === u.name));
    if (userObj) {
      logger.verbose(`lookupUser: Found cached info on jira user: ${user}`);
      return when(userObj);
    }

    let url = `${this.jira_lookup_user_api}?username=${user}`;
    // Use a proxy server if configured
    logger.verbose(`lookupUser: Fetching info on jira user: ${user}`);
    return request(this.convertForProxy(url), this.jiraReqOpts)
      .then((userObj) => {
        if ((userObj.length)) {
          return when.reject(new Error(`User search for ${user} at ${url} ` +
            `returned a list instead of expected user object.`));
        }
        // Add to local cache
        let cachedUser = this.jiraUserCache.find((u) => (userObj.name === u.name));
        if (typeof cachedUser === 'undefined') {
          this.jiraUserCache.push(userObj);
          if (!(this.jiraUserCache.length % 50)) {
            logger.info(`lookupUser: ${this.jiraUserCache.length} users in memory cache.`);
          }
        }
        return when(userObj);
      }).catch((e) => {
      // We are getting a lot of 404s, need to debug why
      // In the meantime, try to guess at users where we get 404s
        if ((e.statusCode === 404) && (process.env.DEFAULT_DOMAIN)) {
          logger.warn(`lookupUser() failed: "${e.message}".  ` +
            `Guessing user's email address by adding ${process.env.DEFAULT_DOMAIN}.`);
          let user = e.options.uri.split('=')[1];
          let userObj = {
            emailAddress: `${user}@${process.env.DEFAULT_DOMAIN}`,
            displayName: user,
            name: user,
            key: user
          };
          return when(userObj);
        } else {
          return when.reject(e);
        }
      });
    // pass exceptions on to caller
  }

  /**
   * Lookup watchers base on info in jira issue object
   *
   * @function lookupWatcherInfoFromIssue
   * @param {object} issue - email or username to lookup
   */
  lookupWatcherInfoFromIssue(issue) {
    let watcherPromise = null;
    let watches = issue.fields.watches;
    if (watches && watches.watchCount && watches.self) {
      // Use a proxy server if configured
      let watcherUrl = watches.self;
      watcherPromise = request.get(this.convertForProxy(watcherUrl),
        this.jiraReqOpts);
    }
    return watcherPromise;
  }

  /**
   * Lookup the issue associated with a comment event
   *
   * @function lookupIssueFromCommentEvent
   * @param {object} commentEvent - email or username to lookup
   */
  lookupIssueFromCommentEvent(commentEvent) {
    let issuePromise = null;
    let commentUrl = commentEvent.comment.self;
    let commentIndex = commentUrl.indexOf('/comment');
    if (commentIndex > 0) {
      let issueUrl = commentUrl.substr(0, commentIndex);
      // Use a proxy server if configured
      issuePromise = request.get(this.convertForProxy(issueUrl), this.jiraReqOpts);
    } else {
      return Promise.reject(new Error('Could not find issue link in comment webhook payload'));
    }
    return issuePromise;
  }

  /**
   * Perform JQL query based on keys
   *
   * @function lookupByKey
   * @param {object} callerName - Log info about the user or space requesting this
   * @param {array} keys - array of jira key names to fetch
   */
  lookupByKey(callerName, keys) {
    let options = JSON.parse(JSON.stringify(this.getDefaultPostOptions()));
    options.body = {"jql": ""};
    options.body.jql = 'key in (' + keys.map(x => '\"' + x + '\"').join(',') + ')';
    return request.post(this.convertForProxy(this.jira_lookup_issue_api), options)
      .then(resp => {
        if (!resp.hasOwnProperty('issues')) {
          reject(new Error('Did not get expected response from Jira watcher lookup. ' +
            'This usually happens due to login failure and redirection.'));
        }
        logger.debug('lookupByKey method found ' + resp.issues.length + ' issues ' +
          'for query filter: ' + options.body.jql +
          ' Requested by user:' + callerName);
        return when(resp.issues);
      }).catch(err => {
        return when.reject(err);
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
    let options = this.getDefaultPostOptions();
    delete options.uri;
    options.url = `${uri}/comment`;
    options.body = {
      "body": fullComment
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
