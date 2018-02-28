# tropo-jira-notifier
Bot to notify users of the Tropo jira system when a ticket has been assigned to them or they have been mentioned.

This bot works only in one on one rooms, not in spaces.   Because its impossible to "leave" a one on one room, the bot supports "shut up", and "come back" commands to turn off notifications.   It also supports a "status" command to check if notifications are on or off.

The first time a user creates a room with the bot a help message is presented.   After that is accesible via the command "help".

The bot also notifies the author jshipher@cisco.com about usage.  For developers who clone this, I request that you please remove this or make yourself the person who is getting the hidden notifications.  (A possible improvement here is to read the admin email from the environment.)

There are a few leftover commands such as "hi", etc from the sample on which this was based.

Each user's status is stored in a Mongo Atlas database.   This could be optionally removed or replaced with another filestore.

## Checklist (absolute bare minimum to get a jira-notifier bot working)

Prerequisites:

- [ ] node.js (minimum supported v4.2.6 with *use-strict* runtime flag & npm 2.14.12 and up)

- [ ] Sign up for Cisco Spark (logged in with your web browser)

- [ ] Administrator of Jira system that you'd like to notify for.   

- [ ] A Mongo Atlas account.

----

- [ ] Create a Cisco Spark Bot (save the API key): https://developer.ciscospark.com/add-bot.html

- [ ] Create or use an existing Mongo Altas DB account and create a Database to save each users setting information in.

- [ ] Sign up for nGrok (save API key) and start it on your machine (save the port number and public web address): https://ngrok.com/download

- [ ] Join a room in Cisco Spark

- [ ] Add the bot to the room in Spark

- [ ] Obtain the roomId from an authenticated GET using the Cisco Spark API: https://developer.ciscospark.com/endpoint-rooms-get.html

- [ ] Create a webhook with the roomId and using your nGrok address, roomId, by POSTing to Cisco Spark API: https://developer.ciscospark.com/endpoint-webhooks-post.html

- [ ] Set the port/nGrok address, and API bot key to the WEBHOOK and TOKEN environment variables.

- [ ] As a Jira adminstrator set a webhook for new Issues and Issue updates to your ngrok addres /jira (ie: https://my.ngrokuro.com/jira).

- [ ] Set the Atlas DB Environment variables: MONGO_USER, MONGO_PW, MONGO_URL, and MONGO_DB

- [ ] Turn on your bot server with ```npm start```
