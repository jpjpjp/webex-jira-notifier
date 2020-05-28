# webex-jira-notifier
Webex Teams Bot to notify Jira users when a ticket has been assigned to them, when they have been mentioned, or when a watched ticket has been updated.  Users can also comment on these tickets directly from within Webex Teams by posting a threaded reply to the notification.  The bot will update the ticket with the message content in a new comment.

This bot works only in one on one rooms, not in spaces.   Because its impossible to "leave" a one on one room, the bot supports "shut up", and "come back" commands to turn off notifications.   It also supports a "status" command to check if notifications are on or off.

Each user's status is stored in a Mongo Atlas database.   This could be optionally removed or replaced with another filestore.  Some type of persistent data store will be necessary to support the status commands.  The bot uses the storage functionality of the [webex-node-bot-framework](https://github.com/webex/webex-node-bot-framework).   If you prefer to use a different persistent data store please read the [framework's storage documentation](https://github.com/webex/webex-node-bot-framework#storage).

The first time a user creates a room with the bot by sending it a message, a help message is presented.   After that is accesible via the command "help".

The bot also notifies the author/admin whose email is specified in the ADMIN_EMAIL environment variable about usage.  There is also an undocumented bot command /showadmintheusers which will send a list of all people using the bot to the space with the Admin user.

## Checklist (absolute bare minimum to get a jira-notifier bot working)

Prerequisites:

- [ ] node.js (minimum supported v10.x.x & npm v6 and up)

- [ ] Sign up for Webex Teams (logged in with your web browser)

- [ ] Administrator of Jira system that you'd like to notify for.   

- [ ] A Mongo Atlas account.

----

- [ ] As a Jira administrator configure Jira to set up a webhook that will fire whenever an Issue is created, updated or deleted.  The url will be the URL where your server is running (for example, an ngrok url during development) appended with '/jira'.  For example: http://myserver.ngrok.io/jira

- [ ] Create a Webex Teams Bot (save the email address and API key): https://developer.ciscospark.com/add-bot.html

- [ ] Create or use an existing Mongo Altas DB account and create a Database to save each users setting information in.
 

## Configuring the bot
Much of the functionality of this app is controlled by enviornement variables. Set the following environment variables in a .env file if running locally or in your production environment.

### Bare Minimum configuration To run

The bare mimimum environment required is:
* TOKEN - the Webex bot token that you got when you created your bot at https://developer.webex.com/add-bot.html
* PORT - the port where your app is running.  This is typically needed when running locally with ngrok, and set automatically when running in a production environemnt.  
* JIRA_URL - the URL of the jira system to monitor, ie:'https://jira.mycompany.com/jira'
* JIRA_USER and JIRA_PW - The username and password of an account that has permission to query watchers and that can post comments on behalf of users.  (For organizations that support it, an enhancement to this bot could be to get each user to provide an OAuth token for the comments.)

### Recommended minimum configuration

While not strictly required during the iterative development process the following variables are used to maintain user state in persistent storage:
* MONGO_URI - the URI string to log into your Mongo Altas DB
* MONGO_BOT_STORE - the name of the collection that your user info will be stored in

It's sometimes useful to get feedback in Webex Teams about the bots health.  It can report when it goes up/down, when new users add it to a space, or when error conditions occur.   Set one of the following to receive these updates:
* ADMIN_EMAIL - the email address of the Webex Teams user to notify about bot activity.  This is generally the developer who maintains this bot


### Special Jira Configurations

Jira webhooks can be configured to send events for new comments.  These are generally redundant with the issue_updated:comment_[created,updated,deleted] events.  If you wish to process the comment event as well set the following:
* PROCESS_COMMENT_EVENTS - when set comment events will be processed and issue_updated:comment_* events will be ignored. (Note that this method is generally less efficient and results in an additional API call to Jira to fetch the issue information anyhow.)

When the bot receives Jira Events it will typically make calls back to the Jira system to lookup the user details for mentioned users and to fetch the watchers for that issue.  The bot also supports a feature which allows users to reply to notifications to add a comment to the issue.   All of these actions require Jira API calls.   The following variables allow configuration of the specific API called for these tasks:
* JIRA_LOOKUP_USER_API - if not set defaults to ${JIRA_URL}/rest/api/2/search
* JIRA_LOOKUP_ISSUE_API - if not set default to ${JIRA_URL}/rest/api/2/search

(Note that the watcher lookup URL is extracted from the jira event and the comment post URL is calculated based on the issue key)

If user lookups fail, the bot contains logic to "guess" the user's email based on a specified default domain.  For example if it discovers a mention with user "fred" it can guess that the email for this user is "fred@company.com", if DEFAULT_DOMAIN is set to company.com.   Note that this logic only takes effect if the lookup user API fails.
* DEFAULT_DOMAIN - the email domain that all your Jira users belong to, ie: "my-company.com".  

### Working with a proxy server to access JIRA
Also optionally, this bot can use a proxy server to route the watcher requests to a jira.  When these variables are set the bot will replace the portion of the wather URL that came with the Jira webhook and replace it with the string in the proxy server.  For example one might set the following environment varialbes:
* JIRA_URL - base URL for my secure jira server ie: https://jira.securecompany.com/jira
* PROXY-URL - base URL for the proxy server, ie: https://jira-proxy.securcompany.com/jira

When using a proxy make sure to set the JIRA_USER and JIRA_PW environment variables to a proxy authorized user.  The proxy server is responsible for replacing this with the credentials for a user authorized in the real system.

### Logging configurations

The bot can be configured to log all the jira events it receives to a directory JiraEvents.   These files can be helpful when intially deploying and troubleshooting the bot.
* LOG_JIRA_EVENTS - set to true to enable jira event logging
  
Finally, the bot contains a logger that can be configured to post log data to [papertrail](https://www.solarwinds.com/papertrail), which provides for remote browser based log viewing.   To enable this create a papertrail account and set the following:
* PAPERTRAIL - set to enable 
* PAPERTRAIL_HOST - host URL provided for your papertrail account
* PAPERTRAIL_PORT - set the port provided for your papertrail account.

Regardless of whether you use papertrail or some other logging mechanism, the bot is configured with levels of logging which can be controlled via:
* LOG_LEVEL - set to debug, verbose, info, warn, or error.  debug (all) logging is enabled if not set

## Group space configurations

The bot can be configurated to work in specifically authorized group spaces through the use environment variables.   The bot can provide two types of authorization in group spaces

### Transition Notifications

The bot can notify group spaces when the status of an issue changes.   At Cisco, we call this a "transition" which may include certain ceremonies.   All of the following environment variables must be set to enable transition notifications in group spaces:

* TRANSITION_SPACE_IDS - A comma seperated list of Webex Teams spaceIds where the bot is allowed to provide transition notifications
* TRANSITION_PROJECTS - A comma seperated list of Jira Project types to notify about
* TRANSITION_STATUS_TYPES - A comma seperated list of status names.  Notifications will be sent when an issue transfers TO one of the statuses on this list
* TRANSITION_ISSUE_TYPES - A comma seperated list of issue types to notify about

Optionally, an additional environment variable can be set to further filter on which transitions will generate a notification:

* JIRA_TRANSITION_BOARDS - A list of board IDs.  If set, the application will query for all the stories for each of the boards and keep a list of issue keys in a memory cache.  When all other transition filter criteria are met, the app will ensure that the issue also belongs to at least one of the configured boards.

The cache is refreshed every 6 hours.




## Starting the bot

Start your node server in your enviornment.  This can be done via a debugger when running locally or by entering the following:
    ```npm start```

## Using the bot

Once the server is up and running Webex Teams users can get Jira Notifications by creating a one-on-on space with the bot.  You will need to inform your users of the email address that you specified when you created the bot at https://developer.ciscospark.com/add-bot.html

Unless specially configured, The bot only works in one on one spaces.  If a user attempts to add it to a group space it will immediately exit.  This ensures that no jira information will ever be shared with a non jira user.  See the optional environment settings below to learn about group space configuration.

When a user succesfully creates a one-on-one space with the bot, they will get an inititial welcome message.  Subsequently the bot will send them messages when they are mentioned in a jira ticket, if a jira ticket is assigned to them, if a jira ticket they were assigned to is assigned to someone else, or if a jira ticket hey were assigned to is deleted.   A private message will be sent from the bot to the user specified via the ADMIN_EMAIL environemnt variable letting them know about the new user.

The following commands are supported:
* status - tells the user about their notification configuration
* shut up - since you can never really "leave" a one on one space, this tells the user to stop notifying them.
* come back - tells the bot to start notifying the user again.
* [yes/no] watchers - turn on or off notifications for stories you are watching (on by default)
* [yes/no] notifyself - turn on or off notifications about jira changes made by you (off by default)
* help - tells the user these commands

Users can also reply to notifications. When this happens the bot will post a comment with the body of the reply.  The reply is posted by the user associated with JIRA_URL/JIRA_PW and includes information that was posted on behalf of the jira user who is mentioned in the comment.   It is not possible to mention other users in comments created by replying to the bot, nor is it possible for the users who sent them to edit them.  (A possible improvement for systems that allow this, is to have users provide an OAuth token which would allow the bot to directly post as thoses users.)

## Testing and Iterative development.
Not all jira systems and versions post exactly the same notification payloads, so you may need to tweek the logic in this bot to work with your system.

To faciliate developing and testing the logic of converting events to notification methods, the project includes a test framework, however since the notification logic requires calling back into jira depending on the contents of the events, users must populate the test framework with their own test cases.  

When the app encounters something unepexpected in the jira webhook payload which causes an exception, the offending payload is saved in the jira-event-test-cases directory.  Developers can use the files here as potential test cases.  

Examine the code in [init-test-cases.js](./sample-jira-event-test-cases/init-test-cases.js) to learn how to set you your own test cases. 

When modifying the jira-notifer module developers can check to ensuer that nothing broke by running the following command:      ```TEST_CASE_DIR=path_to_your_init-test-cases npm test```


## Deploy
The project now comes with a deploy script for deploying in an OpenShift Kubernetes deployment environment. Details in the [deploy readme](./deploy/deploy-to-openshift.md)

## TO-DO
* The current implementation requires that all jira users belong to the same email domain.  A future enhancement might support multiple domains and add code to translate jira mentions to the right email org.
* The current implementation will let ANYONE create a space with our bot, but only users who's webex teams email address belongs to the specified email org will ever be notified.   A nice improvement might be for the bot to tell users this.
* This bot could be enhanced to provide more "write functionality" like creating new jira tickets directly from Webex Teams.