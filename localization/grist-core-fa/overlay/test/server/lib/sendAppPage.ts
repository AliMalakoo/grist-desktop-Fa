import { getLanguageAttributes, makeGristConfig } from "app/server/lib/sendAppPage";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("sendAppPage", function() {
  describe("getLanguageAttributes", function() {
    // A fake request is enough: the language is already resolved by the time the page is rendered.
    const req = (language: string) => ({language} as any);

    it("should mark right-to-left languages, and Persian to use the Jalali calendar", function() {
      const config = {supportedLngs: ["en", "fa", "ar", "he"]} as any;
      assert.equal(getLanguageAttributes(req("fa"), config),
        'lang="fa" dir="rtl" data-calendar="jalali"');
      assert.equal(getLanguageAttributes(req("ar"), config), 'lang="ar" dir="rtl"');
      assert.equal(getLanguageAttributes(req("he"), config), 'lang="he" dir="rtl"');
      assert.equal(getLanguageAttributes(req("en"), config), 'lang="en" dir="ltr"');
      assert.equal(getLanguageAttributes(req("de"), config), 'lang="en" dir="ltr"');
    });

    it("should reduce a regional variant to the language that is offered", function() {
      const config = {supportedLngs: ["en", "fa"]} as any;
      assert.equal(getLanguageAttributes(req("fa-IR"), config),
        'lang="fa" dir="rtl" data-calendar="jalali"');
      assert.equal(getLanguageAttributes(req("en-GB"), config), 'lang="en" dir="ltr"');
    });

    it("should prefer the user's stored locale over the request's language", function() {
      const config = {supportedLngs: ["en", "fa"], userLocale: "fa"} as any;
      assert.equal(getLanguageAttributes(req("en"), config),
        'lang="fa" dir="rtl" data-calendar="jalali"');
    });

    it("should still work for pages served without a gristConfig", function() {
      // The published form and custom-widget.html are rendered with an empty config, which used to
      // mean "English"; the language i18next resolved is trusted instead.
      assert.equal(getLanguageAttributes(req("fa"), {} as any),
        'lang="fa" dir="rtl" data-calendar="jalali"');
      assert.equal(getLanguageAttributes(req("fr"), {} as any), 'lang="fr" dir="ltr"');
      assert.equal(getLanguageAttributes(req("zh-CN"), {} as any), 'lang="zh" dir="ltr"');
      // Anything that cannot be a language tag is not echoed into the markup.
      assert.equal(getLanguageAttributes(req('a" onload="alert(1)'), {} as any), 'lang="a" dir="ltr"');
      assert.equal(getLanguageAttributes(req(""), {} as any), 'lang="en" dir="ltr"');
    });
  });

  describe("makeGristConfig", function() {
    let oldEnv: testUtils.EnvironmentSnapshot;

    beforeEach(function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
    });

    afterEach(function() {
      oldEnv.restore();
    });

    it("reports whether Redis is configured", function() {
      delete process.env.REDIS_URL;
      delete process.env.TEST_REDIS_URL;
      assert.isFalse(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);

      process.env.REDIS_URL = "redis://localhost";
      assert.isTrue(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);

      // A test Redis counts too, matching how GristJobs picks its queue backend.
      delete process.env.REDIS_URL;
      process.env.TEST_REDIS_URL = "redis://localhost/11";
      assert.isTrue(makeGristConfig({ homeUrl: null, extra: {} }).redisAvailable);
    });
  });
});
