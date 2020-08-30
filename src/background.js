// Param values from https://developer.mozilla.org/Add-ons/WebExtensions/API/contextualIdentities/create
const TIKTOK_CONTAINER_DETAILS = {
  name: "TikTok",
  color: "purple",
  icon: "apple"
};

const ALL_TIKTOK_DOMAINS = [
  "tiktok.com",
  "tiktok.org",
  "tiktokcdn.com",
  "tiktokv.com",
  "muscdn.com",
  "musical.ly",
  "musically.ly",
  "v16-tiktokcdn-com.akamaized.net",
  "p16-tiktokcdn-com.akamaized.net",
  "mon.byteoversea.com",
  "mon-va.byteoversea.com",
  "abtest-va-tiktok.byteoversea.com",
  "sf-tb-sg.ibytedtos.com",
  "xlog-va.byteoversea.com",
  "dm-maliva16.byteoversea.com",
  "dm.bytedance.com",
  "sgali3.l.byteoversea.net",
  "tiktokcdn-com.akamaized.net",
  "ibytedtos.com",
  "app.musemuse.cn",
  "share.musemuse.cn"
];

TIKTOK_DOMAINS = TIKTOK_DOMAINS.concat(
  ALL_TIKTOK_DOMAINS,  
);

const MAC_ADDON_ID = "@testpilot-containers";

let macAddonEnabled = false;
let tiktokCookieStoreId = null;

const canceledRequests = {};
const tabsWaitingToLoad = {};
const tabStates = {};

const tiktokHostREs = [];

async function isMACAddonEnabled () {
  try {
    const macAddonInfo = await browser.management.get(MAC_ADDON_ID);
    if (macAddonInfo.enabled) {
      sendJailedDomainsToMAC();
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

async function setupMACAddonListeners () {
  browser.runtime.onMessageExternal.addListener((message, sender) => {
    if (sender.id !== "@testpilot-containers") {
      return;
    }
    switch (message.method) {
    case "MACListening":
      sendJailedDomainsToMAC();
      break;
    }
  });
  function disabledExtension (info) {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = false;
    }
  }
  function enabledExtension (info) {
    if (info.id === MAC_ADDON_ID) {
      macAddonEnabled = true;
    }
  }
  browser.management.onInstalled.addListener(enabledExtension);
  browser.management.onEnabled.addListener(enabledExtension);
  browser.management.onUninstalled.addListener(disabledExtension);
  browser.management.onDisabled.addListener(disabledExtension);
}

async function sendJailedDomainsToMAC () {
  try {
    return await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "jailedDomains",
      urls: TIKTOK_DOMAINS.map((domain) => {
        return `https://${domain}/`;
      })
    });
  } catch (e) {
    // We likely might want to handle this case: https...
    return false;
  }
}

async function getMACAssignment (url) {
  if (!macAddonEnabled) {
    return false;
  }

  try {
    const assignment = await browser.runtime.sendMessage(MAC_ADDON_ID, {
      method: "getAssignment",
      url
    });
    return assignment;
  } catch (e) {
    return false;
  }
}

function cancelRequest (tab, options) {
  // we decided to cancel the request at this point, register canceled request
  canceledRequests[tab.id] = {
    requestIds: {
      [options.requestId]: true
    },
    urls: {
      [options.url]: true
    }
  };

  // since webRequest onCompleted and onErrorOccurred are not 100% reliable
  // we register a timer here to cleanup canceled requests, just to make sure we don't
  // end up in a situation where certain urls in a tab.id stay canceled
  setTimeout(() => {
    if (canceledRequests[tab.id]) {
      delete canceledRequests[tab.id];
    }
  }, 2000);
}

function shouldCancelEarly (tab, options) {
  // we decided to cancel the request at this point
  if (!canceledRequests[tab.id]) {
    cancelRequest(tab, options);
  } else {
    let cancelEarly = false;
    if (canceledRequests[tab.id].requestIds[options.requestId] ||
        canceledRequests[tab.id].urls[options.url]) {
      // same requestId or url from the same tab
      // this is a redirect that we have to cancel early to prevent opening two tabs
      cancelEarly = true;
    }
    // register this requestId and url as canceled too
    canceledRequests[tab.id].requestIds[options.requestId] = true;
    canceledRequests[tab.id].urls[options.url] = true;
    if (cancelEarly) {
      return true;
    }
  }
  return false;
}

function generateTikTokHostREs () {
  for (let tiktokDomain of TIKTOK_DOMAINS) {
    tiktokHostREs.push(new RegExp(`^(.*\\.)?${tiktokDomain}$`));
  }
}

async function clearTikTokCookies () {
  // Clear all tiktok cookies
  const containers = await browser.contextualIdentities.query({});
  containers.push({
    cookieStoreId: "firefox-default"
  });

  let macAssignments = [];
  if (macAddonEnabled) {
    const promises = TIKTOK_DOMAINS.map(async tiktokDomain => {
      const assigned = await getMACAssignment(`https://${tiktokDomain}/`);
      return assigned ? tiktokDomain : null;
    });
    macAssignments = await Promise.all(promises);
  }

  TIKTOK_DOMAINS.map(async tiktokDomain => {
    const tiktokCookieUrl = `https://${tiktokDomain}/`;

    // dont clear cookies for tiktokDomain if mac assigned (with or without www.)
    if (macAddonEnabled &&
        (macAssignments.includes(tiktokDomain) ||
         macAssignments.includes(`www.${tiktokDomain}`))) {
      return;
    }

    containers.map(async container => {
      const storeId = container.cookieStoreId;
      if (storeId === tiktokCookieStoreId) {
        // Don't clear cookies in the TikTok Container
        return;
      }

      const cookies = await browser.cookies.getAll({
        domain: tiktokDomain,
        storeId
      });

      cookies.map(cookie => {
        browser.cookies.remove({
          name: cookie.name,
          url: tiktokCookieUrl,
          storeId
        });
      });
      // Also clear Service Workers as it breaks detecting onBeforeRequest
      await browser.browsingData.remove({hostnames: [tiktokDomain]}, {serviceWorkers: true});
    });
  });
}

async function setupContainer () {
  // Use existing TikTok container, or create one

  const info = await browser.runtime.getBrowserInfo();
  if (parseInt(info.version) < 67) {
    TIKTOK_CONTAINER_DETAILS.color = "purple";
    TIKTOK_CONTAINER_DETIALS.color = "apple";
  }

  const contexts = await browser.contextualIdentities.query({name: TIKTOK_CONTAINER_DETAILS.name});
  if (contexts.length > 0) {
    const tiktokContext = contexts[0];
    tiktokCookieStoreId = tiktokContext.cookieStoreId;
    if (tiktokContext.color !== TIKTOK_CONTAINER_DETAILS.color ||
        tiktokContext.icon !== TIKTOK_CONTAINER_DETAILS.icon) {
          await browser.contextualIdentities.update(
            tiktokCookieStoreId,
            { color: TIKTOK_CONTAINER_DETAILS.color, icon: TIKTOK_CONTAINER_DETAILS.icon }
          );
    }
  } else {
    const context = await browser.contextualIdentities.create(TIKTOK_CONTAINER_DETAILS);
    tiktokCookieStoreId = context.cookieStoreId;
  }

  const azcStorage = await browser.storage.local.get();
  if (!azcStorage.domainsAddedToTikTokContainer) {
    await browser.storage.local.set({ "domainsAddedToTikTokContainer": [] });
  }
}

async function maybeReopenTab(url, tab, request) {
  const macAssigned = await getMACAssignment(url);
  if (macAssigned) {
    return;
  }

  const cookieStoreId = await shouldContainInto(url, tab);
  if (!cookieStoreId) {
    return;
  }

  if (request && shouldCancelEarly(tab, request)) {
    return { cancel: true };
  }

  await browser.tabs.create({
    url,
    cookieStoreId,
    active: tab.active,
    index: tab.index,
    windowId: tab.windowId
  });

  browser.tabs.remove(tab.id);

  return { cancel: true };
}

function isTikTokURL (url) {
  const parsedUrl = new URL(url);
  for (let tiktokHostRE of tiktokHostREs) {
    if (tiktokHostRE.test(parsedUrl.host)) {
      return true;
    }
  }
  return false;
}

async function supportsSiteSubdomainCheck(url) {
  // No subdomains to check at this time
  return;
}

async function addDomainToTikTokContainer (url) {
  const parsedUrl = new URL(url);
  const azcStorage = await browser.storage.local.get();
  azcStorage.domainsAddedToTikTokContainer.push(parsedUrl.host);
  await browser.storage.local.set({"domainsAddedToTikTokContainer": azcStorage.domainsAddedToTikTokContainer});
  await supportSiteSubdomainCheck(parsedUrl.host);
}

async function removeDomainFromTikTokContainer (domain) {
  const azcStorage = await browser.storage.local.get();
  const domainIndex = azcStorage.domainsAddedToTikTokContainer.indexOf(domain);
  azcStorage.domainsAddedToTikTokContainer.splice(domainIndex, 1);
  await browser.storage.local.set({"domainsAddedToTikTokContainer": azcStorage.domainsAddedToTikTokContainer});
}

async function isAddedToTikTokContainer (url) {
  const parsedUrl = new URL(url);
  const azcStorage = await browser.storage.local.get();
  if (azcStorage.domainsAddedToTikTokContainer.includes(parsedUrl.host)) {
    return true;
  }
  return false;
}

async function shouldContainInto (url, tab) {
  if (!url.startsWith("http")) {
    // we only handle URLs starting with http(s)
    return false;
  }

  const hasBeenAddedToTikTokContainer = await isAddedToTikTokContainer(url);

  if (isTikTokURL(url) || hasBeenAddedToTikTokContainer) {
    if (tab.cookieStoreId !== tiktokCookieStoreId) {
      // TikTok-URL outside of TikTok Container Tab
      // Should contain into TikTok Container
      return tiktokCookieStoreId;
    }
  } else if (tab.cookieStoreId === tiktokCookieStoreId) {
    // Non-TikTok-URL inside TikTok Container Tab
    // Should contain into Default Container
    return "firefox-default";
  }

  return false;
}

async function maybeReopenAlreadyOpenTabs () {
  const tabsOnUpdated = (tabId, changeInfo, tab) => {
    if (changeInfo.url && tabsWaitingToLoad[tabId]) {
      // Tab we're waiting for switched it's url, maybe we reopen
      delete tabsWaitingToLoad[tabId];
      maybeReopenTab(tab.url, tab);
    }
    if (tab.status === "complete" && tabsWaitingToLoad[tabId]) {
      // Tab we're waiting for completed loading
      delete tabsWaitingToLoad[tabId];
    }
    if (!Object.keys(tabsWaitingToLoad).length) {
      // We're done waiting for tabs to load, remove event listener
      browser.tabs.onUpdated.removeListener(tabsOnUpdated);
    }
  };

  // Query for already open Tabs
  const tabs = await browser.tabs.query({});
  tabs.map(async tab => {
    if (tab.url === "about:blank") {
      if (tab.status !== "loading") {
        return;
      }
      // about:blank Tab is still loading, so we indicate that we wait for it to load
      // and register the event listener if we haven't yet.
      //
      // This is a workaround until platform support is implemented:
      // https://bugzilla.mozilla.org/show_bug.cgi?id=1447551
      // https...
      tabsWaitingToLoad[tab.id] = true;
      if (!browser.tabs.onUpdated.hasListener(tabsOnUpdated)) {
        browser.tabs.onUpdated.addListener(tabsOnUpdated);
      }
    } else {
      // Tab already has an url, maybe we reopen
      maybeReopenTab(tab.url, tab);
    }
  });
}

function stripAzclid(url) {
  const strippedUrl = new URL(url);
  strippedUrl.searchParams.delete("azclid");
  return strippedUrl.href;
}

async function getActiveTab () {
  const [activeTab] = await browser.tabs.query({currentWindow: true, active: true});
  return activeTab;
}

async function windowFocusChangedListener (windowId) {
  if (windowId !== browser.windows.WINDOW_ID_NONE) {
    const activeTab = await getActiveTab();
    updateBrowserActionIcon(activeTab);
  }
}

function tabUpdateListener (tabId, changeInfo, tab) {
  updateBrowserActionIcon(tab);
}

async function updateBrowserActionIcon (tab) {

  browser.browserAction.setBadgeText({text: ""});

  const url = tab.url;
  const hasBeenAddedToTikTokContainer = await isAddedToTikTokContainer(url);

  if (isTikTokURL(url)) {
    browser.storage.local.set({"CURRENT_PANEL": "on-tiktok"});
    browser.browserAction.setPopup({tabId: tab.id, popup: "./panel.html"});
  } else if (hasBeenAddedToTikTokContainer) {
    browser.storage.local.set({"CURRENT_PANEL": "in-azc"});
  } else {
    const tabState = tabStates[tab.id];
    const panelToShow = (tabState && tabState.trackersDetected) ? "trackers-detected" : "no-trackers";
    browser.storage.local.set({"CURRENT_PANEL": panelToShow});
    browser.browserAction.setPopup({tabId: tab.id, popup: "./panel.html"});
    browser.browserAction.setBadgeBackgroundColor({color: "#A44D00"});
    if ( panelToShow === "trackers-detected" ) {
      browser.browserAction.setBadgeText({text: "!"});
    }
  }
}

async function containTikTok (request) {
  if (tabsWaitingToLoad[request.tabId]) {
    // Cleanup just to make sure we don't get a race-condition with startup reopening
    delete tabsWaitingToLoad[request.tabId];
  }

  const tab = await browser.tabs.get(request.tabId);

  updateBrowserActionIcon(tab);

  const url = new URL(request.url);
  const urlSearchParm = new URLSearchParams(url.search);
  if (urlSearchParm.has("azclid")) {
    return {redirectUrl: stripAzclid(request.url)};
  }
  // Listen to requests and open TikTok into its Container,
  // open other sites into the default tab context
  if (request.tabId === -1) {
    // Request doesn't belong to a tab
    return;
  }

  return maybeReopenTab(request.url, tab, request);
}

// Lots of this is borrowed from old blok code:
// https://github.com/mozilla/blok/blob/master/src/js/background.js
async function blockTikTokSubResources (requestDetails) {
  if (requestDetails.type === "main_frame") {
    return {};
  }

  if (typeof requestDetails.originUrl === "undefined") {
    return {};
  }

  const urlIsTikTok = isTikTokURL(requestDetails.url);
  const originUrlIsTikTok = isTikTokURL(requestDetails.originUrl);

  if (!urlIsTikTok) {
    return {};
  }

  if (originUrlIsTikTok) {
    const message = {msg: "tiktok-domain"};
    // Send the message to the content_script
    browser.tabs.sendMessage(requestDetails.tabId, message);
    return {};
  }

  const hasBeenAddedToTikTokContainer = await isAddedToTikTokContainer(requestDetails.originUrl);

  if (urlIsTikTok && !originUrlIsTikTok) {
    if (!hasBeenAddedToTikTokContainer ) {
      const message = {msg: "blocked-tiktok-subresources"};
      // Send the message to the content_script
      browser.tabs.sendMessage(requestDetails.tabId, message);

      tabStates[requestDetails.tabId] = { trackersDetected: true };
      return {cancel: true};
    } else {
      const message = {msg: "allowed-tiktok-subresources"};
      // Send the message to the content_script
      browser.tabs.sendMessage(requestDetails.tabId, message);
      return {};
    }
  }
  return {};
}

function setupWebRequestListeners() {
  browser.webRequest.onCompleted.addListener((options) => {
    if (canceledRequests[options.tabId]) {
      delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});
  browser.webRequest.onErrorOccurred.addListener((options) => {
    if (canceledRequests[options.tabId]) {
      delete canceledRequests[options.tabId];
    }
  },{urls: ["<all_urls>"], types: ["main_frame"]});

  // Add the main_frame request listener
  browser.webRequest.onBeforeRequest.addListener(containTikTok, {urls: ["<all_urls>"], types: ["main_frame"]}, ["blocking"]);

  // Add the sub-resource request listener
  browser.webRequest.onBeforeRequest.addListener(blockTikTokSubResources, {urls: ["<all_urls>"]}, ["blocking"]);
}

function setupWindowsAndTabsListeners() {
  browser.tabs.onUpdated.addListener(tabUpdateListener);
  browser.tabs.onRemoved.addListener(tabId => delete tabStates[tabId] );
  browser.windows.onFocusChanged.addListener(windowFocusChangedListener);
}

(async function init () {
  await setupMACAddonListeners();
  macAddonEnabled = await isMACAddonEnabled();

  try {
    await setupContainer();
  } catch (error) {
    // TODO: Needs backup strategy
    // See ...
    // Sometimes this add-on is installed but doesn't get a tiktokCookieStoreId ?
    // eslint-disable-next-line no-console
    console.log(error);
    return;
  }
  clearTikTokCookies();
  generateTikTokHostREs();
  setupWebRequestListeners();
  setupWindowsAndTabsListeners();

  browser.runtime.onMessage.addListener( (message, {url}) => {
    if (message === "what-sites-are-added") {
      return browser.storage.local.get().then(azcStorage => azcStorage.domainsAddedToTikTokContainer);
    } else if (message.removeDomain) {
      removeDomainFromTikTokContainer(message.removeDomain).then( results => results );
    } else {
      addDomainToTikTokContainer(url).then( results => results);
    }
  });

  maybeReopenAlreadyOpenTabs();

  const activeTab = await getActiveTab();
  updateBrowserActionIcon(activeTab);
})();
