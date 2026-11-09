import {test as base,expect} from '@playwright/test';
import {fixture,session} from '../support/harness.mjs';
export const test=base.extend({
 f:async({},use)=>{const f=await fixture('typescript');try{await use(f);}finally{await f.dispose();}},
 app:async({f},use)=>{await use(await f.server({wait:true}));},
});
export {expect};
export async function load(page,app){await page.goto(app.url);await expect(page.locator('.file-card').first()).toBeVisible();}
export async function addComment(page,text,kind='add'){
 await page.locator('.line.'+kind+' .comment-trigger').first().click();await page.locator('#comment-body').fill(text);await page.getByRole('button',{name:'Add to review',exact:true}).click();
}
export async function graph(page){await page.locator('#route-mode').click();await expect(page.locator('.graph-svg')).toBeVisible();}
export async function select(page,path){await page.getByRole('button',{name:'Select '+path,exact:true}).press('Enter');await expect(page.locator('#graph-file-content')).toBeVisible();}
export async function send(page){await page.locator('#review').click();await page.locator('#send').click();await expect(page.locator('#handoff')).not.toBeVisible();await expect(page.locator('#review-status-text')).toContainText('Review submitted');}
