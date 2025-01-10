#!/bin/bash
#export LOGPIPE_ENDPOINT="https://logpipe.frk.wf"
#export LOGPIPE_AUTHKEY=""

export LOGPIPE_TAG="app:nostrtc"

if [ -z "$LOGPIPE_ENDPOINT" ]; then
  LOGPIPE_ENDPOINT="http://127.0.0.1:7068"
fi

if [ -z "$LOGPIPE_FORMAT" ]; then
  LOGPIPE_FORMAT="cconsole"
fi

if [ -z "$LOGPIPE_AUTHKEY" ]; then
  echo "LOGPIPE_AUTHKEY is not set"
  exit 1
fi

endpoint="$LOGPIPE_ENDPOINT/stream?format=$LOGPIPE_FORMAT&authKey=$LOGPIPE_AUTHKEY&limit=1&filter=$LOGPIPE_TAG"

echo "Connecting to $endpoint"
npx wscat --no-color --connect $endpoint
