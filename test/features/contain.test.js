describe("Contain", () => {
  let webExtension, background, tiktokContainer;

  beforeEach(async () => {
    webExtension = await loadWebExtension();
    background = webExtension.background;
    tiktokContainer = webExtension.tiktokContainer;
  });

  describe("All requests stripped of fbclid param", () => {
    const responses = {};
    beforeEach(async () => {
    });

    it("should redirect non-TikTok urls with fbclid stripped", async () => {
      await background.browser.tabs._create({url: "https://github.com/?fbclid=123"}, {responses});
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.redirectUrl).to.equal("https://github.com/");
    });

    it("should preserve other url params", async () => {
      await background.browser.tabs._create({url: "https://github.com/mozilla/contain-tiktok/issues?q=is%3Aissue+is%3Aopen+track&fbclid=123"}, {responses});
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.redirectUrl).to.equal("https://github.com/mozilla/contain-tiktok/issues?q=is%3Aissue+is%3Aopen+track");
    });

    it("should redirect TikTok urls with fbclid stripped", async () => {
      await background.browser.tabs._create({url: "https://www.tiktok.com/help/securitynotice?fbclid=123"}, {responses});
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.redirectUrl).to.equal("https://www.tiktok.com/help/securitynotice");
    });
  });

  describe("Incoming requests to TikTok Domains outside of TikTok Container", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://www.tiktok.com"
      }, {
        responses
      });
    });

    it("should be reopened in TikTok Container", async () => {
      expect(background.browser.tabs.create).to.have.been.calledWithMatch({
        url: "https://www.tiktok.com",
        cookieStoreId: tiktokContainer.cookieStoreId
      });
    });

    it("should be canceled", async () => {
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.cancel).to.be.true;
    });
  });

  describe("Incoming requests to Non-TikTok Domains inside TikTok Container", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://example.com",
        cookieStoreId: tiktokContainer.cookieStoreId
      }, {
        responses
      });
    });

    it("should be reopened in Default Container", async () => {
      expect(background.browser.tabs.create).to.have.been.calledWithMatch({
        url: "https://example.com",
        cookieStoreId: "firefox-default"
      });
    });

    it("should be canceled", async () => {
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result.cancel).to.be.true;
    });
  });


  describe("Incoming requests that don't start with http", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "ftp://www.tiktok.com"
      }, {
        responses
      });
    });

    it("should be ignored", async () => {
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result).to.be.undefined;
    });
  });


  describe("Incoming requests that don't belong to a tab", () => {
    const responses = {};
    beforeEach(async () => {
      await background.browser.tabs._create({
        url: "https://www.tiktok.com",
        id: -1
      }, {
        responses
      });
    });

    it("should be ignored", async () => {
      expect(background.browser.tabs.create).to.not.have.been.called;
      const [promise] = responses.webRequest.onBeforeRequest;
      const result = await promise;
      expect(result).to.be.undefined;
    });
  });
});
