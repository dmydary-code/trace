import {defineConfig} from '@playwright/test';
export default defineConfig({
 outputDir:process.env.TRACE_ACCEPTANCE?'test-results/acceptance':'test-results/browser',testDir:'./tests/e2e',grepInvert:process.env.TRACE_ACCEPTANCE?undefined:/@acceptance/,timeout:30000,expect:{timeout:5000},fullyParallel:false,workers:2,retries:0,forbidOnly:!!process.env.CI,
 reporter:[['list'],['json',{outputFile:process.env.TRACE_ACCEPTANCE?'test-results/acceptance-browser-results.json':'test-results/browser-results.json'}],['html',{open:'never',outputFolder:process.env.TRACE_ACCEPTANCE?'playwright-report/acceptance':'playwright-report/regression'}]],
 use:{viewport:{width:1440,height:1000},reducedMotion:'reduce',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'chromium',use:{browserName:'chromium'}},{name:'webkit',use:{browserName:'webkit'}}],
});
