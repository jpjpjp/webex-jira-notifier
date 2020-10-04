# webex-jira-notifier

Webex Teams Bot to notify Jira users when a ticket has been assigned to them, when they have been mentioned, or when a watched ticket has been updated.  Users can also comment on these tickets directly from within Webex Teams by posting a threaded reply to the notification.  The bot will update the ticket with the message content in a new comment.

By default, this bot works only in one on one rooms, not in spaces.   Because its impossible to "leave" a one on one room, the bot supports "shut up", and "come back" commands to turn off notifications.   It also supports a "status" command to check if notifications are on or off.

It is possible to configure this bot to run in Webex group spaces as well.   This is described in the [Group Notifier Readme](./group-notifier/README.md)

Each user's status is stored in a Mongo Atlas database.   This could be optionally removed or replaced with another filestore.  Some type of persistent data store will be necessary to support the status commands.  The bot uses the storage functionality of the [webex-node-bot-framework](https://github.com/webex/webex-node-bot-framework).   If you prefer to use a different persistent data store please read the [framework's storage documentation](https://github.com/webex/webex-node-bot-framework#storage).

The first time a user creates a space with the bot by sending it a message, a help message is presented.   After that is accesible via the command "help".

## Checklist (absolute bare minimum to get a jira-notifier bot working)

Prerequisites:

- [ ] node.js (minimum supported v14.x.x & npm v6 and up)

- [ ] Sign up for Webex Teams (logged in with your web browser)

- [ ] Administrator of Jira system that you'd like your users to be notified about

- [ ] A Mongo Atlas account

----

- [ ] As a Jira administrator configure Jira to set up a webhook that will fire whenever an Issue is created, updated or deleted.  The url will be the URL where your server is running (for example, an ngrok url during development) appended with '/jira'.  For example: http://myserver.ngrok.io/jira.

- [ ] As a Jira administrator, create a jira user to associate with the bot.  This user should have read access to all the jira projects that your users are interested in being notified about.

- [ ] Create a Webex Teams Bot (save the email address and API key): https://developer.ciscospark.com/add-bot.html

- [ ] Create or use an existing [Mongo Altas DB account](https://docs.mongodb.com/guides/cloud/account/) and get its connection URL

## Configuring the bot

Much of the functionality of this app is controlled by environment variables. Set the following environment variables in a .env file if running locally or in your production environment.

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
* ADMIN_SPACE_ID - if you have multiple admins looking after the bot, set this to the roomId of that space.  If both are set, the ADMIN_SPACE_ID is preferred.  Note that the bot must already be in this space before setting either of these.

There are also some other undocumented commands that admins may find handy, search for "/showadmin" in [server.js](./server.js)

### Special Jira Configurations

Jira webhooks can be configured to send events for new comments.  These are generally redundant with the issue_updated:comment_[created,updated,deleted] events.  If you wish to process the comment event as well set the following:
* PROCESS_COMMENT_EVENTS - when set comment events will be processed and issue_updated:comment_* events will be ignored. (Note that this method is generally less efficient and results in an additional API call to Jira to fetch the issue information anyhow.)

When the bot receives Jira Events it will typically make calls back to the Jira system to lookup the user details for mentioned users and to fetch the watchers for that issue.  The bot also supports a feature which allows users to reply to notifications to add a comment to the issue.   All of these actions require Jira API calls.   The following variables allow configuration of the specific API called for these tasks:

* JIRA_LOOKUP_USER_API - if not set defaults to ${JIRA_URL}/rest/api/2/search
* JIRA_LOOKUP_ISSUE_API - if not set default to ${JIRA_URL}/rest/api/2/search
* inspect [jira-connector.js](./jira-connector.js) for other configurations that can be modified by URL
  
(Note that the watcher lookup URL is extracted from the jira event and the comment post URL is calculated based on the issue key)

### Working with a proxy server to access JIRA

Also optionally, this bot can use a proxy server to route API requests to a jira.  This can be useful if security requirements prohibit a direct connection between the bot and the environment where jira is running.  

When these variables are set the bot will replace the portion of the jira API URL that is being called it with the string in the proxy server.  For example one might set the following environment variables:

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

## Starting the bot

Install dependencies once by running `npm install`.

Start your node server in your environment.  This can be done via a debugger when running locally or by entering the following:
    ```npm start```

## Using the bot

Once the server is up and running Webex Teams users can get notified about changes to jira issues by creating a one-on-on space with the bot.  You will need to inform your users of the email address that you specified when you created the bot at https://developer.ciscospark.com/add-bot.html

Unless specially configured, The bot only works in one on one spaces.  If a user attempts to add it to a group space it will immediately exit, unless the [Group Notifier module](./group-notifier/README.md) is enabled.  This ensures that no jira information will ever be shared with a non jira user.  

When a user succesfully creates a one-on-one space with the bot, they will get an initial welcome message.  Subsequently the bot will send them messages when they are mentioned in a jira ticket, if a jira ticket is assigned to them, if a jira ticket they were assigned to is assigned to someone else, or if a jira ticket hey were assigned to is deleted.   If configured a private message will be sent from the bot to admin space when this occurs. 

The following commands are supported:

* status - tells the user about their notification configuration
* shut up - since you can never really "leave" a one on one space, this tells the user to stop notifying them.
* come back - tells the bot to start notifying the user again.
* [yes/no] watchers - turn on or off notifications for stories you are watching (on by default)
* [yes/no] notifyself - turn on or off notifications about jira changes made by you (off by default)
* help - tells the user these commands

Users can also reply to notifications. When this happens the bot will post a comment with the body of the reply.  The reply is posted by the user associated with JIRA_URL/JIRA_PW and includes information that was posted on behalf of the jira user who is mentioned in the comment.   It is not possible to mention other users in comments created by replying to the bot, nor is it possible for the users who sent them to edit them.  (A possible improvement for systems that allow this, is to have users provide an OAuth token which would allow the bot to directly post as thoses users.)

## Testing and Iterative development

Not all jira systems and versions post exactly the same notification payloads, so you may need to tweek the logic in this bot to work with your system.

To faciliate developing and testing the logic of converting events to notification methods, the project includes a test framework, however since the notification logic requires calling back into jira depending on the contents of the events, users must populate the test framework with their own test cases.

The test cases are admiteddly under-documented, and providing that documentation never quite makes it to the top of my to-do list.  If you are interested in using this project and want to leverage the tests please open an issue which will help with my motiviation.

For the more impatient, xxamine the code in [init-test-cases.js](./sample-jira-event-test-cases/init-test-cases.js) may help you learn how to set you your own test cases.

## Deploy

The project now comes with a deploy script for deploying in an OpenShift Kubernetes deployment environment. Details in the [deploy readme](./deploy/deploy-to-openshift.md)

## TO-DO

- The current implementation will let ANYONE create a space with our bot, but only users who's webex teams email address belongs to the specified email org will ever be notified.   A nice improvement might be for the bot to tell users this.
- This bot could be enhanced to provide more "write functionality" like creating new jira tickets directly from Webex Teams.
