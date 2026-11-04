#!/bin/sh
# Firebase 주소(https://kokwork.web.app)에 올린다.
# git 에 올라간 파일만 올린다 (사용법 HTML·.app 같은 로컬 파일은 절대 안 올라감)
set -e
cd "$(dirname "$0")"
rm -rf _site
mkdir _site
git archive HEAD | tar -x -C _site
rm -f _site/firebase.json _site/.firebaserc _site/deploy-firebase.sh _site/README.md _site/database.rules.json
"$HOME/.npm-global/bin/firebase" deploy --only hosting --project shift-calendar-e973e
rm -rf _site
