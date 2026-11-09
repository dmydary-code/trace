import {test,expect,load,addComment} from './fixtures.mjs';
test('N-04/B-03 lost acknowledgement reconciles saved review without false not-sent message',async({page,app})=>{
 await load(page,app);await addComment(page,'Saved feedback');await page.route('**/api/reviews',async route=>{await route.fetch();await route.abort();});await page.locator('#review').click();await page.locator('#send').click();
 await expect(page.locator('#handoff')).not.toBeVisible();await expect(page.locator('#review-status-text')).toContainText('submitted');await expect(page.locator('#toast')).not.toContainText('not sent');
});
