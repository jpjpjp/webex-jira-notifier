// jira-connector.js
//
// An object for interacting with the Jira system
// in a room with our bot
/*jshint esversion: 6 */  // Help out our linter

// When running locally read environment variables from a .env file
//require('dotenv').config();
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
      this.proxy_url = '';
      this.jira_url_regexp = null;
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
        this.jiraAllowedProjects = [];
        this.jiraDisallowedProjects = [];
        if (process.env.JIRA_PROJECTS) {
          this.jiraAllowedProjects = process.env.JIRA_PROJECTS.split(/,\s*/);
        }

        // Check if our environment overrode the lookup by username path
        if (process.env.JIRA_LOOKUP_USER_API) {
          this.jiraLookupUserApi = process.env.JIRA_LOOKUP_USER_API;
        } else {
          this.jiraLookupUserApi = `${this.jira_url}/rest/api/2/user`;
        }

        // Check if our environment overrode the default endpoint to get 
        // the list of projects our user can access
        if (process.env.JIRA_AVAILABLE_PROJECTS_URL) {
          this.jiraLookupMyProjectsApi = process.env.JIRA_AVAILABLE_PROJECTS_URL;
        } else {
          this.jiraLookupMyProjectsApi = `${this.jira_url}/rest/api/2/issue/createmeta`;
        }

        // Check if our environment overrode the lookup by username path
        if (process.env.JIRA_LOOKUP_ISSUE_API) {
          this.jiraLookupIssueApi = process.env.JIRA_LOOKUP_ISSUE_API;
        } else {
          this.jiraLookupIssueApi = `${this.jira_url}/rest/api/2/search`;
        }

        // Check if our environment overrode the lookup board info URL
        if (process.env.JIRA_LOOKUP_FILTER_API) {
          this.jiraLookupFilterApi = process.env.JIRA_LOOKUP_FILTER_API;
        } else {
          this.jiraLookupFilterApi = `${this.jira_url}/rest/api/2/filter`;
        }        

        // Set a regular expression to validate our expectation of a board URL
        // There seem to be several different ways to get to this so we'll try
        // anything that ends with a query param called "filter"
        // TODO override with environment variable
        this.filterUrlRegExp = new RegExp(/^.*\?filter=\d+$/);
        
        // Check if our environment overrode the lookup filter info URL
        if (process.env.JIRA_LOOKUP_BOARD_API) {
          this.jiraLookupBoardApi = process.env.JIRA_LOOKUP_BOARD_API;
        } else {
          this.jiraLookupBoardApi = `${this.jira_url}/rest/agile/1.0/board`;
        }

        // Set (or use an environment supplied) pattern for board's web URLs
        if (process.env.JIRA_BOARD_WEB_URL_PATTERN) {
          this.boardViewUrlPattern= JIRA_BOARD_WEB_URL_PATTERN;
        } else {
          this.boardViewUrlPattern = `${this.jira_url}/secure/RapidBoard.jspa?rapidView=`;
        }
        // Set a regular expression to validate our expectation of a board URL
        // TODO override with environment variable
        this.boardUrlRegExp = new RegExp(/^.*RapidBoard\.jspa\?rapidView=\d+$/);

        // Check if our bot is configured to send transition notifications only for
        // issues that belong to certain boards
        this.transitionBoards = [];
        this.transitionStories = [];
        if (process.env.JIRA_TRANSITION_BOARDS) {
          this.jiraTransitionBoards = process.env.JIRA_TRANSITION_BOARDS.split(/,\s*/);
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
   * Accessor for list of project names associated
   * with failed watcher lookup requests
   *
   * @function getDisallowedProjects
   */
  getDisallowedProjects() {
    return this.jiraDisallowedProjects;
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
   * @param {object} userOrEmail - email or username to lookup
   * @returns {Promise.<user>} - a single jira user object
   */
  lookupUser(userOrEmail) {
    let user = userOrEmail.substring(0, userOrEmail.indexOf('@')) ? userOrEmail.substring(0, userOrEmail.indexOf('@')) : userOrEmail
    let url = `${this.jiraLookupUserApi}?username=${user}`;
    // Use a proxy server if configured
    logger.verbose(`lookupUser: Fetching info on jira user: ${user}`);
    return request(this.convertForProxy(url), this.jiraReqOpts)
  }

  /**
   * From a username try to get the user object which will
   * contain an email, which a notifier bot needs to send
   * a notification.
   * This method includes an optimization to cache previously
   * lookup up users.
   *
   * @function getUserObjectFromUsername
   * @param {object} user - email or username to lookup
   * @returns {Promise.<user>} - a single jira user object
   */
  getUserObjectFromUsername(user) {
    // Check our local cache first
    let userObj = this.jiraUserCache.find((u) => (user === u.name));
    if (userObj) {
      logger.verbose(`lookupUser: Found cached info on jira user: ${user}`);
      return when(userObj);
    }
    return this.lookupUser(user)
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
      });
    // pass exceptions on to caller
  }

  /** 
   * Lookup the projects our jira user has access to
   * 
   * @function lookupAvailableProjects
   * @return {Promise.array} -- if succesfull a list of project objects
   */
  async lookupAvailableProjects() {
    let url = this.jiraLookupMyProjectsApi;
    return request(this.convertForProxy(url), this.jiraReqOpts)
    .then((resp) => {
      if (typeof resp?.projects !== 'object') {
        return Promise.reject(new Error(`jiraConnector.lookupWatcherInfoFromIssue did not get expected response object`));
      }
      let projects = [];
      resp.projects.forEach(project => {
        projects.push({
          id: project.id,
          self: project.self,
          key: project.key,
          name: project.name
        });
      });
      return when(projects);
    });
  }

  /**
   * Lookup watchers base on info in jira issue object
   * 
   * This method includes some logic to try to "get smart"
   * about which projects it is able to see watchers in and 
   * which it isn't.  As it gets 403 responses for certain projects
   * it will add them to a disallowed list and no longer attempt
   * to find watchers for those projects.
   *
   * @function lookupWatcherInfoFromIssue
   * @param {object} issue - email or username to lookup
   */
  lookupWatcherInfoFromIssue(issue) {
    let watches = issue.fields.watches;
    let project = '';
    if ((typeof issue.fields === 'object') && (typeof issue.fields.project === 'object')) {
      project = issue.fields.project.key;
      if (-1 !== this.jiraDisallowedProjects.indexOf(project)) {
        logger.debug(`Skipping watcher lookup in known dissallowed project: ${project}`);
        return when(null);
      }
    } 
    if (watches && watches.watchCount && watches.self) {
      // Use a proxy server if configured
      let watcherUrl = watches.self;
      return request.get(this.convertForProxy(watcherUrl), this.jiraReqOpts)
        .then(watcherInfo => {
          if (-1 === this.jiraAllowedProjects.indexOf(project)) {
            // Temporary so I see this in the logs
            logger.error(`Got watcher info for project "${issue.fields.project.key}` +
              ` but it is not in our allowed project list.`);
            this.jiraAllowedProjects.push(project);
          }
          return when(watcherInfo);
        }).catch(e => {
          if (e.statusCode === 403) {
            if (-1 === this.jiraDisallowedProjects.indexOf(project)) {
            // Temporary so I see this in the logs
              logger.warn(`Failed getting watcher info for project "${issue.fields.project.key}` +
              ` adding it to the disallowed list.`);
              this.jiraDisallowedProjects.push(project);
            }
          }
          return when.reject(e);
        });
    }
    return when(null);
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
    return request.post(this.convertForProxy(this.jiraLookupIssueApi), options)
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

  /**
   * Lookup a jira list by specified type
   * Currently "board" and "filter" are supported
   * 
   * @function lookupListByIdAndType
   * @param {string} listID - id of a Jira list
   * @param {string} listType - a supported jira list type, ie: "board", "filter"
   * @return {<Promise>} - if resolved, the jira object for the list
   */
  lookupListByIdAndType(listId, listType) {
    let listPromise;
    if (listType === 'board') {
      listPromise = this.lookupBoardById(listId);
    } else if (listType === 'filter') {
      listPromise = this.lookupFilterById(listId);
    } else {
      let msg = `lookupListByIdAndType failed with an unknown list type "${listType}"`;
      logger.info(msg);
      return Promise.reject(new Error(msg));
    }
    return listPromise;
  }

  /**
   * Lookup a jira board by ID
   * 
   * @function lookupBoardById
   * @param {string} boardID - id of a Jira board
   * @return {<Promise>} - if resolved, the jira object for the board
   */
  lookupBoardById(boardId) {
    let boardUrl = `${this.jiraLookupBoardApi}/${boardId}`;
    let boardInfo;
    return request.get(this.convertForProxy(boardUrl), this.jiraReqOpts)
      .then(board => {
        boardInfo = board;
        logger.debug(`Found info for boardId: ${boardInfo.id}, name: ${boardInfo.name}, fetching filter info..`);
        return this.lookupBoardConfiguration(boardInfo);
      })
      .then((boardConfig) => this.lookupFilterById(boardConfig.filter.id))
      .then((filter) => {
        logger.debug(`Found config and filter for boardId: ${boardInfo.id}, creating a consolidated object`);
        // Jira's native board object does not return its viewUrl like it does for filter
        boardInfo.viewUrl = this.viewUrlFromBoardId(boardId);
        boardInfo.type = 'board';
        boardInfo.filter = {
          id: filter.id,
          name: filter.name
        };
        boardInfo.searchUrl = filter.searchUrl;
        return boardInfo;
      })
      .catch(e => {
        logger.info(`lookupBoardById failed lookup for boardID:${boardId}: ${e.message}`);
        return Promise.reject(e);
      });
  }

  /**
   * Lookup a jira boards configuration
   * 
   * @function lookupBoardConfiguration
   * @param {string} board - a Jira board object
   * @return {<Promise>} - if resolved, the jira configuration object for the board
   */
  lookupBoardConfiguration(board) {
    let configUrl = `${board.self}/configuration`;
    return request.get(this.convertForProxy(configUrl), this.jiraReqOpts);
  } 
  

  /**
   * Lookup a jira filter by ID
   * 
   * @function lookupFilterById
   * @param {string} filterID - id of a Jira filter
   * @return {<Promise>} - if resolved, the jira object for the filter
   */
  lookupFilterById(filterId) {
    let filterUrl = `${this.jiraLookupFilterApi}/${filterId}`;
    return request.get(this.convertForProxy(filterUrl), this.jiraReqOpts)
      .then(filterInfo => {
        logger.info(`Found info for filterId: ${filterInfo.id}, name: ${filterInfo.name}`);
        filterInfo.type = 'filter';
        // For some reason board.id is a number and filter.id is a string
        // Lets convert here to be consistent
        // TODO -- how hard would it be to go the other way?
        filterInfo.id = parseInt(filterInfo.id);
        return filterInfo;
      })
      .catch(e => {
        logger.info(`lookupFilterById failed lookup for filter ID:${filterId}: ${e.message}`);
        return Promise.reject(e);
      });
  }

  /**
   * Build a viewUrl from a board ID based on expected patterns
   *
   * @function viewUrlFromBoardId
   * @param {integer} boardId - id of board
   * @return {string} - web url of Jira Board that user can click on
   */
  viewUrlFromBoardId(boardId) {
    return `${this.boardViewUrlPattern}${boardId}`;
  }

  /**
   * Extract the issues List ID from a jira web URL
   * An issues List ID could be a jira board, a filter or some other
   * type in the future
   * 
   * This function will also resolve if it is passed just an ID 
   * (digit string) and the type
   *
   * @function getBoardOrFilterObjFromIdOrUrl
   * @param {string} issuesListUrl - web url of Jira Board to lookup
   * @param {string} issuesLisType - optional, type of list (ie: board, filter)
   * @return {<Promise>{Integer}} - if resolved, an object with the list id and type
   */
  getBoardOrFilterObjFromIdOrUrl(issuesListUrl, issuesListType=null) {
    let listId;
    let listIdObj = {};
    // Check if this is already a listId
    if (listId = parseInt(issuesListUrl)) {
      if ((issuesListType === 'board') || (issuesListType == 'filter')) {
        listIdObj.id = listId;
        listIdObj.type = issuesListType;
        return when(listIdObj);
      } else {
        return when.reject(new Error(`getBoardOrFilterObjFromIdOrUrl: ID was supplied without specifying a known listId type`));
      }
    }
    // Make sure this URL matches our configured JIRA
    if (!issuesListUrl.startsWith(this.jira_url)) {
      return when.reject(new Error(`getBoardOrFilterObjFromIdOrUrl: List URL does not match jira this bot is configured to talk to`));
    }
    // Check if this URL matches one of our known types
    if (this.boardUrlRegExp.test(issuesListUrl)) {
      listIdObj.type = 'board';
    } else if (this.filterUrlRegExp.test(issuesListUrl)) { 
      listIdObj.type = 'filter';
    } else {
      // Cannot find known list type from URL
      return when.reject(new Error(`getBoardOrFilterObjFromIdOrUrl: List URL does include a know list lookup pattern`));
    }
    // Extract the list ID from the URL
    let listIdString = issuesListUrl.slice(issuesListUrl.lastIndexOf('=')+1);
    if (listId = parseInt(listIdString)) {
      listIdObj.id = listId;
      return when(listIdObj);
    }
    return when.reject(new Error(`getBoardOrFilterObjFromIdOrUrl: listId in URL does no appear to be a number as expected`));
  }
  /**
   * Lookup a jira board by web URL
   * 
   * @function lookupBoardByUrl
   * @param {string} boardUrl - url of Jira Board to lookup
   * @return {<Promise>{object}} - if resolved, a jira board object
   */
  lookupBoardByUrl(boardUrl) {
    // Make sure this URL matches our configured JIRA
    if (!boardUrl.startsWith(this.jira_url)) {
      return Promise.reject(new Error(`lookupBoardByUrl: Board URL does not match jira this bot is configured to talk to`));
    }
    if (!this.boardUrlRegExp.test(boardUrl)) {
      return Promise.reject(new Error(`lookupBoardByUrl: Board URL does include expected lookup pattern`));
    }
    let boardId = boardUrl.slice(boardUrl.lastIndexOf('=')+1);
    return this.lookupBoardById(boardId);
  }

  /**
   * Add a list of issue keys to a list object
   * Currently supported types are "board" and "filter"
   * 
   * @function lookupAndStoreListIssues
   * @param {object} list - a jira board or filter object
   * @return {<Promise>} - if resolved, list object will have a list of issue objects
   */
  lookupAndStoreListIssues(list) {
    let issuesUrl;
    if (list.type === 'board') {
      issuesUrl = `${list.self}/issue`;
    } else if (list.type === 'filter') {
      issuesUrl = list.searchUrl;
    } else {
      let msg = `lookupAndStoreListIssues: Could not lookup issues for unknown list type ${list.type}`;
      logger.error(msg);
      return Promise.reject(new Error(msg));
    }
    return this.getStoriesFromUrl(issuesUrl)
      .then((stories) => {
        list.stories = stories.map(s => s.key);
        logger.info(`Got all ${list.stories.length} issues for ${list.type} Id:${list.id}, name: ${list.name}`);
        return(list);
      });
  }

  /**
   * Is issue in our TR Notification Filter Cache
   * 
   * @function issueInTRFilterList
   * @param {string} key - issue key for TR Notification candidate
   * @return {object} - array of boards that have the issue on them
   */
  issueInTRFilterList(key) {
    return this.transitionStories.filter(boardInfo => {
      return (-1 != boardInfo.stories.indexOf(key));
    }); 
  }

  /**
   * Gets board info given a list of boardIds
   * @private
   * @function getInfoForBoards
   * @param {Array} boardIds - list of boardIds to fetch
   * @returns {Promise.Array} - returns array with an info object for each board
   */
  getInfoForBoards(boardIds) {
    let boardsInfo = [];
    return Promise.all(boardIds.map(boardId => {
      let boardUrl = `${this.jiraLookupBoardApi}/${boardId}`;
      return request.get(this.convertForProxy(boardUrl), this.jiraReqOpts)
        .then(boardInfo => {
          logger.info(`Will notify of transitions on boardId: ${boardInfo.id}, name: ${boardInfo.name}`);
          return boardsInfo.push(boardInfo);
        })
        .catch(e => {
          logger.info(`jiraConnector:getInfoForBoards failed lookup for boardID "${boardId}": ${e.message}`);
          return Promise.reject(e);
        });
    }))
      .then(() => boardsInfo);
  }

  /**
   * Add the child stories to a list of boardsInfo
   * @private
   * @function getStoriesForBoards
   * @param {Array} boards - list of board info objects 
   * @returns {Promise.Array} - returns array with an info object for each board
   */
  getStoriesForBoards(boards) {
    let boardsWithStories = [];
    return Promise.all(boards.map(board => {
      let issuesUrl = `${board.self}/issue`;
      let options = JSON.parse(JSON.stringify(this.jiraReqOpts));
      return this.getStoriesFromUrl(issuesUrl, options)
        .then(stories => {
          board.stories = stories.map(s => s.key);
          logger.info(`Got all ${board.stories.length} issues on boardId: ${board.id}, name: ${board.name}`);
          boardsWithStories.push(board);
        });
    }))
      .then(() => boardsWithStories);
  }

  /**
   * 
   * Recursively fetch all the stories for a given board
   * @private
   * @function getStoriesFromUrl
   * @param {string} url - url to get stories from
   * @param {Object} options - optional request options 
   * @param {Array} stories - stories collected so far
   * @returns {Promise.Array} - returns array with user stories
   */
  getStoriesFromUrl(url, options=null, stories=null) {
    if (!options) {
      options = JSON.parse(JSON.stringify(this.jiraReqOpts));
    }
    return request.get(this.convertForProxy(url), options)
      .then(issuesListObj => {
        if (!stories) {
          stories = [];
        }
        if (issuesListObj.total) {
          stories = stories.concat(issuesListObj.issues);
        }
        if (issuesListObj.issues.length === issuesListObj.maxResults) {
          options.qs = {startAt: stories.length};
          logger.debug(`Fetching eligible transtion stories from ${url}/?startAt=${stories.length}`);
          return this.getStoriesFromUrl(url, options, stories);
        }
        return stories;
      });
  }


}

module.exports = JiraConnector;
