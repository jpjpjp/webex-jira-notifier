# webex-jira-notifier
Webex Teams Bot to notify users of Jira when a ticket has been assigned to them, when they have been mentioned, or when a watched ticket has been updated.  Users can also comment on these tickets directly from within Webex Teams by posting a threaded reply to the notification.  The bot will update the ticket with the message content in a new comment.

This bot works only in one on one rooms, not in spaces.   Because its impossible to "leave" a one on one room, the bot supports "shut up", and "come back" commands to turn off notifications.   It also supports a "status" command to check if notifications are on or off.

Each user's status is stored in a Mongo Atlas database.   This could be optionally removed or replaced with another filestore.  Some type of persistent data store will be necessary to support the status commands.

The first time a user creates a room with the bot a help message is presented.   After that is accesible via the command "help".

The bot also notifies the author/admin whose email is specified in the ADMIN_EMAIL environment variable about usage.  There is also an undocumented bot command /showadmintheusers which will send a list of all people using the bot in the space with the Admin user.

## Checklist (absolute bare minimum to get a jira-notifier bot working)

Prerequisites:

- [ ] node.js (minimum supported v8.16.0 & npm v6 and up)

- [ ] Sign up for Webex Teams (logged in with your web browser)

- [ ] Administrator of Jira system that you'd like to notify for.   

- [ ] A Mongo Atlas account.

----

- [ ] As a Jira administrator configure Jira to set up a webhook that will fire whenever an Issue is created, updated or deleted.  The url will be the URL where your ngrok server is running (during development), or the url where your app ins running in production, with appended with '/jira'.  For example: http://myserver.ngrok.io/jira

- [ ] Create a Webex Teams Bot (save the email address and API key): https://developer.ciscospark.com/add-bot.html

- [ ] Create or use an existing Mongo Altas DB account and create a Database to save each users setting information in.
 

## Starting the server

Set the following environment varibles in a .env file if running locally or in your production environment:
* TOKEN - the token that you got when you created your bot at https://developer.ciscospark.com/add-bot.html
* PORT - the port where your app is running.  This is typically needed when running locally with ngrok, and set automatically when running in a production environemnt.
* EMAIL_ORG - the email domain that all your Jira users belong to, ie: "my-company.com"
* MONGO_URI - the URI string to log into your Mongo Altas DB
* MONGO_BOT_STORE - the name of the collection that your user info will be stored in
* JIRA_URL - the URL of the jira system to monitor, ie:'https://jira.mycompany.com/jira'
* JIRA_USER and JIRA_PW - The username and password of an account that has permission to query watchers and that can post comments on behalf of users.  (For organizations that support it, an enhancement to this bot could be to get each user to provide an OAuth token for the comments.)
* ADMIN_EMAIL - the email address of the Webex Teams user to notify about bot activity.  This is generally the developer who maintains this bot
* ADMIN_SPACE_ID - If you have multiple users who want to be informed of the bot's usage you can set a Webex Teams space ID for the bot to post to.  This space must already exist.   If this is set ADMIN_EMAIL is ignored.

Also optionally, this bot can use a proxy server to route the watcher requests to a jira.  When these variables are set the bot will replace the portion of the wather URL that came with the Jira webhook and replace it with the string in the proxy server.  For example one might set the following environment varialbes:
* JIRA_URL - base URL for my secure jira server ie: https://jira.securecompany.com/jira
* PROXY-URL - base URL for the proxy server, ie: https://jira-proxy.securcompany.com/jira

When using a proxy make sure to set the JIRA environment token to a proxy authorized user.  The proxy server is responsible for replace this with the credentials for a user authorized in the real system.

Start your node server in your enviornment.  This can be done via a debugger when running locally or by entering the following:
    ```npm start```

## Using the bot

Once the server is up and running Cisco Spark users can get Jira Notifications by creating a one-on-on space with the bot.  You will need to inform your users of the email address that you specified when you created the bot at https://developer.ciscospark.com/add-bot.html

The bot only works in one on one spaces.  If a user attempts to add it to a group space it will immediately exit.

When a user succesfully creates a one-on-one space with the bot, they will get an inititial welcome message.  Subsequently the bot will send them messages when they are mentioned in a jira ticket, if a jira ticket is assigned to them, if a jira ticket they were assigned to is assigned to someone else, or if a jira ticket hey were assigned to is deleted.   A private message will be sent from the bot to the user specified via the ADMIN_EMAIL environemnt varialbe letting them know about the new user.

The following commands are supported:
* shut up - since you can never really "leave" a one on one space, this tells the user to stop notifying them.
* come back - tells the bot to start notifying the user again.
* status - tells the user if the bot is notifying them or not
* help - tells the user these commands


## Tests
The project comes with a set of reference Jira events.  When modifying the jira-notifer module developers can check to ensuer that nothing broke by running the following command:      ```npm test```

When the app encounters something unepexpected in the jira webhook payload which causes an exception, the offending payload is saved in the jira-event-test-cases directory.  Developerss can modify the test-jira-event-handler.js to send new payloads to the test framework and modify the app to support these payloads

## TO-DO
* The current implementation requires that all jira users belong to the same email domain.  A future enhancement might support multiple domains and add code to translate jira mentions to the right email org.
* The current implementation will let ANYONE create a space with our bot, but only users who's webex teams email address belongs to the specified email org will ever be notified.   A nice improvement might be for the bot to tell users this.
* This bot could be enhanced to provide more "write functionality" like creating new jira tickets directly from Webex Teams.