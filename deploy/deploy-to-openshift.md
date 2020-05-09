# Deploy to Openshift
This project provides a mechanism to automate deployment to a Redhat OpenShift container service platform.  Red Hat Openshift is a Platform as a Service based on Kubernetes.   This deploy logic can likely be modified to work with other Kubernetes based deployment environments.

## Prerequisites
The deploy script expects an existing OpenShift project and pipeline and simply automates pushing "an update".   The work that should have been completed prior to running this deploy includes:

1. An OpenStack instance is already set up and configured.  In our instance we have the following configured:
   - a *project* which contains the following resources needed for our app to run.  (The project concept maps roughly to the *namespace* concept in kubernetes)
   - a *route* that exposes a public IP address that our Jira instance is configured to send webhooks to.  (The route concept roughly aligns with the *Ingress* and *Ingress Controller* resource concepts in Kubernetes)
   - a *pod* that can run a docker image with our app
   - a *service* that relays data sent from to the public IP address to the port exposed by our docker image. 
   - a *config map*, where the environment variables used by our applciation are stored.
   - a *secret* needed to pull a new container from docker container hub
2. A Docker Container Hub instance has been configured to host our images.   Any pull secrets needed to fetch the image should have already been loaded to and configured in OpenStack project's secrets resource.
3. OpenStack and Docker cli are both installed and have been logged into.  Docker has logged into the Container Hub instance where we will push to.
4. package.json version has been updated since the last deploy
5. .env file exists in the deploy directory with the appropriate data set.

The deploy results in a generated YAML configuration specifying the configuration of the service and the pod being pushed to the OpenShift project resulting in a re-deploy using the latest image.   
  
## Required Environment Variables

This project allows us to share an automated deploy script without exposing any secrets or information about the environment where our app is running.  It relies on the following environment variables:

* PROJECT_NAME - The OpenShift project that your app will be deployed in.
* SERVICE_NAME - The OpenShift service that will map requests sent to a public IP address to a port exposed by your docker image
* INCOMING_PORT - The public port exposed by the docker image
* TARGET_PORT - The internal image port the app is listening on
* CONFIG_NAME - The name of the OpenShift Config Map where environment variables are specified
* APP_NAME - The name of the docker image
* CONTAINER_HUB - The url of the container hub instance
* USER_NAME - The username of the user who owns the container hub instance
* PULL_SECRET - The name of the file that contains the pull secret that OpenShift needs to pull down an image from ${CONTAINER_HUB}/${USER_NAME}/${APP_NAME}

## Doing a deploy

Running `npm run deploy`, will kick off a deployment,which consists of the following steps


1) Generate an OpenShift YAML configuration for the the new build.  The logic for generating the yaml configuration is in [build-yaml-from-json.js](./build-json-from-yaml.js).  It reads two "seed" configuration files from the input directory and replaces templatized values in them with values from the environment or from the projects [package.json](../package.json).   The output is an OpenShift YAML configuration file written to the output directory. 
   
   As a rule, the only thing that changes in the resulting YAML configuration from build to build is the image tag version.
   
2) Generate the creation of a new docker image based on the current proejct state and tagged with a version number from package.json.  This is done by calling `docker build` using the [Dockerfile](./Dockerfile) in this directory and tagging the output based on the version number from [package.json](../package.json).
   
   It's worth noting that in OpenShift, containers do not run by default as *root* as they do in Kubernetes, but instead run under an *arbitrary user*.  For this reason you will note that the Dockerfile runs `chown` on several created directories and files in order to ensure that our application can read from and/or write to them.
   
3) Push the new docker image to the enterprise docker hub.  This is done by calling `docker push` with the newly created image.   (It is expected that the user has already run `docker login` and cached credentials for the enteprise control hub locally.)
   
4) Push the OpenShift YAML configuration generated in step 1 to OpenShift instructing it to pull and run the latest imange in docker hub.  (It is expected that the user has already run `oc login` and cached credentials for OpenShift locally.)

## Creating your own seed configurations

In the input directory are two "seed" configurations. These are JSON representations of an OpenShift configuration that instructs the platform to run a service and deploy a docker image.   They were generated from the original configuration YAML that was created when the project was first setup.  After they were originally generated, all the project specific information and secrets in them were replaced by template values.

Unless your OpenShift setup aligns exactly with the prerequisites described here, its quite likely that you may need to create your own seeds.   To do this you may use the [build-json-from-yaml.js](./build-json-from-yaml.js) file in this directory.  It is currently hardcoded to read from a file called `cisco-jira-notifier.yaml`.  It generates an output seed file for each YAML document in the configuration.   

Go through the generated seed file(s) and replace the specific locations and secrets with [mustache style](https://www.npmjs.com/package/mustache) template values.  (Note that the template values are generally camel case versions of the environment variables described above).

You may need to add your own template values.  If so, edit [buildbuild-yaml-from-json.js](./build-yaml-from-json.js) accordingly, and update the creation of the `view` that is used for template expansion on line 34.



