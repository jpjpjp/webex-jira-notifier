/*
 * deploy.js
 *
 * Program to generate docker container, push to container hub
 * and load new deployment yaml to OpenStack
 * 
 * The container version is extracted from ../package.json
 * 
 * The deployment yaml is built from seed json configurations
 * that use templatized values.  The template is expanded based
 * on the package version and environment variables set in the local .env
 * 
 * Prequisites:
 * 
 * 1. An OpenStack instance is already set up and configured.  This
 *    script simply pushes a new image to ECH and pushes a new yaml
 *    to openstack to run it.  Secret to pull from ECH has been loaded.
 * 2. OpenStack cli is installed and configured with credentials needed to login
 * 3. Docker is installed and configred with credentials to log in to target
 *    Container Hub
 * 4. package.json version has been updated since the last deploy
 * 5  Environment sets the following variables:
 * 
 * 
 * Execution is halted if any of the executed programs returns and error
 * Output is send to stdout and stderr
 */

const util = require('util');
const exec = util.promisify(require('child_process').exec);
require('dotenv').config();

const package_version = require('../package.json').version;
const buildTimestamp = new Date();
const workAbove = {
  cwd: '..'
};
const workHere = {
  cwd: '..'
};



// Build the deploy yaml from the seed configs and environment
// This runs asyncronously but should complete before the docker image
// is build and pushed to container hub
require('./build-yaml-from-json');
deployNewBuild();

async function deployNewBuild() {
  try {
    console.log('Starting docker build....');
    await waitForExec(`docker build ` +
    `--build-arg BUILD_TIMESTAMP="${buildTimestamp}" ` +
      `-t ${process.env.CONTAINER_HUB}/${process.env.USER_NAME}/${process.env.APP_NAME}:${package_version} .`, 
    workAbove);
    console.log('Build Complete.  Starting docker push....');
    await waitForExec(`docker push ` +
        `${process.env.CONTAINER_HUB}/${process.env.USER_NAME}/${process.env.APP_NAME}:${package_version}`, 
    workAbove);
    console.log('Push Complete.  Starting oc apply....');
    await waitForExec(`oc apply data-out.yaml`, workHere);
    console.log('Deploy Succeeded?');
  } catch (err) {
    console.error(`Deploy Failed: ${err.message}`);
  }
}

async function waitForExec(command, workingDir) {
  try {
    const { stdout, stderr } = await exec(command, workingDir);
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
    return Promise.resolve(true);
  }catch (err) {
    return Promise.reject(err);
  };
};
