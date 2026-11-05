// A loaded page acknowledges that it fetched and rendered the local diff.
export function browserFallback(url,open,{delay=8000,schedule=setTimeout,cancel=clearTimeout}={}){
 let timer=schedule(()=>{timer=null;open(url);},delay);
 return ()=>{if(timer!==null){cancel(timer);timer=null;}};
}
