/* globals FBInstant */
import { ExternalUserInfo } from './external_user_info.js';

const { registerExternalUserInfoProvider } = require('./social.js');
const urlhash = require('./urlhash.js');
const local_storage = require('./local_storage.js');
const { ID_PROVIDER_FB_INSTANT } = require('glov/common/enums.js');
const { callEach } = require('glov/common/util.js');

export let ready = false;
let onreadycallbacks = [];
export function onready(callback) {
  if (ready) {
    return void callback();
  }
  onreadycallbacks.push(callback);
}

let hasSubscribedAlready = false;
function initSubscribe(callback, skipShortcut) {

  skipShortcut = skipShortcut||false;

  function handleSubscribeToBotComplete() {
    if (callback) {
      //Prevents the handleSubscribeToBotComplete promise from eating unfreeze event errors
      setTimeout(callback,1);
    }
  }

  function handleSubscribeToBotFailure(e) {
    if (e && e.code !== 'USER_INPUT') {
      console.error('handleSubscribeToBotFailure', e);
    }
    FBInstant.logEvent('bot_subscribe_failure');
    handleSubscribeToBotComplete();
  }

  function subscribeToBot() {
    console.warn('Window social trying to bot subscribe');
    if (FBInstant.getSupportedAPIs().indexOf('player.canSubscribeBotAsync') !== -1) {
      FBInstant.player.canSubscribeBotAsync().then(function (canSubscribe) {
        if (canSubscribe) {
          FBInstant.logEvent('bot_subscribe_show');
          FBInstant.player.subscribeBotAsync().then(function () {
            FBInstant.logEvent('bot_subscribe_success');
            handleSubscribeToBotComplete();
          },handleSubscribeToBotFailure).catch(handleSubscribeToBotFailure);
        } else {
          handleSubscribeToBotComplete();
        }
      }).catch(handleSubscribeToBotFailure);
    } else {
      handleSubscribeToBotComplete();
    }
  }

  function handleHomescreenComplete() {
    subscribeToBot();
  }

  function handleCreateShortcutFailure(e) {
    console.error('handleCreateShortcutFailure', e);
    FBInstant.logEvent('homescreen_install_failure');
    handleHomescreenComplete();
  }

  let hasAddedToHomescreen = local_storage.get('instant.hasInstalledShortcut.v2');
  function createShortcut() {
    console.warn('Window social trying to create shortcut');
    if (FBInstant.getSupportedAPIs().indexOf('canCreateShortcutAsync') !== -1 &&
      !hasAddedToHomescreen &&
      !hasSubscribedAlready
    ) {
      hasSubscribedAlready = true;
      FBInstant.canCreateShortcutAsync().then(function (canCreateShortcut) {
        if (canCreateShortcut) {
          FBInstant.logEvent('homescreen_install_show');
          FBInstant.createShortcutAsync().then(function () {
            local_storage.set('instant.hasInstalledShortcut.v2',true);
            FBInstant.logEvent('homescreen_install_success');
            handleHomescreenComplete();
          },function () {
            FBInstant.logEvent('homescreen_install_useraborted');
            handleHomescreenComplete();
          }).catch(handleCreateShortcutFailure);
        } else {
          handleHomescreenComplete();
        }
      }).catch(handleCreateShortcutFailure);
    } else {
      handleHomescreenComplete();
    }
  }

  if (skipShortcut) {
    subscribeToBot();
  } else {
    createShortcut();
  }
}

let on_pause = [];
export function fbInstantOnPause(cb) {
  on_pause.push(cb);
}

let can_follow_official_page;
let can_join_official_group;
let can_get_live_streams_overlay;

export function fbGetLoginInfo(cb) {
  onready(() => {
    window.FBInstant.player.getSignedPlayerInfoAsync().then((result) => {
      if (cb) {
        cb(null, {
          signature: result.getSignature(),
          display_name: window.FBInstant.player.getName(),
        });
        cb = null;
      }
    }).catch((err) => {
      if (cb) {
        cb(err);
        cb = null;
      }
    });
  });
}

/// Maps a player to an ExternalUserInfo
function mapPlayerToExternalUserInfo(player) {
  return new ExternalUserInfo(player.getID(), player.getName(), player.getPhoto());
}

/// Returns an ExternalUserInfo
function fbInstantGetPlayer(cb) {
  onready(() => {
    let player = window.FBInstant.player;
    cb(null, player ? mapPlayerToExternalUserInfo(player) : undefined);
  });
}

/// cb receives an error if any occurs and an array of ExternalUserInfo objects
function fbInstantGetFriends(cb) {
  onready(() => {
    window.FBInstant.player.getConnectedPlayersAsync().then((players) => {
      if (cb) {
        cb(null, players?.map(mapPlayerToExternalUserInfo));
        cb = null;
      }
    }).catch((err) => {
      if (cb) {
        cb(err);
        cb = null;
      }
    });
  });
}

export function fbGetAppScopedUserId(cb) {
  onready(() => {
    window.FBInstant.player.getASIDAsync().then((asid) => {
      if (cb) {
        cb(null, asid);
        cb = null;
      }
    }).catch((err) => {
      if (cb) {
        cb(err);
        cb = null;
      }
    });
  });
}

export function canFollowOfficialPage() {
  return window.FBInstant && can_follow_official_page;
}

export function canJoinOfficialGroup() {
  return window.FBInstant && can_join_official_group;
}

export function canShowLiveStreamOverlay() {
  return window.FBInstant && can_get_live_streams_overlay;
}

export function init() {
  if (!window.FBInstant) {
    return;
  }

  let left = 1;
  let fake_load_interval = setInterval(function () {
    left *= 0.9;
    FBInstant.setLoadingProgress(100-(left*100)>>0);
  },100);

  FBInstant.initializeAsync().then(function () {
    let entryPointData = FBInstant.getEntryPointData()||{};
    // let entryPointData = { querystring: { w: '4675', wg: '1' } }; // FRVR
    // let entryPointData = { querystring: { blueprint: 'RKWVAE26XS24Z' } }; // FRVR
    let querystring = entryPointData.querystring||{};
    for (let x in querystring) {
      urlhash.set(x, querystring[x]);
    }

    clearInterval(fake_load_interval);
    ready = true;
    FBInstant.startGameAsync().then(function () {
      registerExternalUserInfoProvider(ID_PROVIDER_FB_INSTANT, fbInstantGetPlayer, fbInstantGetFriends);

      onreadycallbacks.forEach((e) => e());
      onreadycallbacks = [];

      console.log('Initializing FBInstant');
      initSubscribe(function () {
        console.log('All done initing FBInstant');
        can_follow_official_page = window.FBInstant.community.canFollowOfficialPageAsync();
        can_join_official_group = window.FBInstant.community.canJoinOfficialGroupAsync();
        can_get_live_streams_overlay = window.FBInstant.community.canGetLiveStreamsAsync();
      });
    });
  }).catch(function (e) {
    console.warn('FBInstant initializeAsync failed', e);
  });

  FBInstant.onPause(() => {
    callEach(on_pause);
  });
}
