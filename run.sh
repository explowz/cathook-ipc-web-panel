#!/bin/bash

if ! [ -e "wpanel/scripts/browser.js" ]; then
  git pull --ff-only
  npm install
  ./node_modules/.bin/browserify browser.js -o wpanel/scripts/browser.js
fi

if ! [ -e "node_modules" ]; then
  git pull --ff-only
  npm install
  ./node_modules/.bin/browserify browser.js -o wpanel/scripts/browser.js
fi

LOG=network/wpanel-logs/main.log

if [ $EUID != 0 ]; then
  echo "0"
  exit
fi

$(which node || which nodejs) app >$LOG
