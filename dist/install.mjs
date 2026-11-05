// Installation stays under browser control; the website cannot install itself.
export function createInstallUI({openSheet,toast}){
  let deferredPrompt=null,installed=false,busy=false;
  const standalone=window.matchMedia('(display-mode: standalone)');
  const inApp=()=>installed||standalone.matches||navigator.standalone===true;
  const ios=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  function button(){return inApp()?'':`<button type="button" class="secondary install-app" data-install-app>安裝 APP</button>`;}
  function panel(){return `<div class="card install-card"><div class="card-heading"><h2>把日常有餘，放進手機。</h2><span class="pill" data-install-state>${inApp()?'APP 模式使用中':'手機網頁 APP'}</span></div><p>主畫面一點就開，記帳更順手。</p><div class="row">${button()}<button type="button" class="text-btn" data-install-help>查看安裝步驟</button></div><p class="help">首次請連網開啟並完成快取；日常記帳可離線，AI 辨識需要網路。帳目與金鑰保存在使用中的瀏覽器／APP；換入口後若資料未出現，請回原入口匯出備份，切勿先清除資料。</p></div>`;}
  function refresh(){
    document.querySelectorAll('[data-install-app]').forEach(b=>{b.hidden=inApp();b.disabled=busy;});
    document.querySelectorAll('[data-install-state]').forEach(b=>b.textContent=inApp()?'APP 模式使用中':'手機網頁 APP');
  }
  function help(){
    const apple=`<section class="install-steps"><h3>iPhone／iPad</h3><ol><li>使用 Safari 開啟本站；若在聊天軟體內，先改用外部瀏覽器。</li><li>點「分享」（部分版面需先點選單），選「加入主畫面」。</li><li>若有「作為網頁 App 開啟」，請保持開啟，再點「加入」。</li></ol></section>`;
    const android=`<section class="install-steps"><h3>Android／Samsung</h3><ol><li>使用 Chrome 開啟本站。</li><li>點右上角 ⋮，選「安裝並建立捷徑」或「加到主畫面」。</li><li>選「安裝」，依照手機畫面完成確認。</li></ol><p class="help">尚未出現安裝視窗時，先使用瀏覽器選單。Samsung Internet 的選單文字可能不同。</p></section>`;
    openSheet('安裝日常有餘 APP',`<p>安裝免費，不需要透過 App 商店。最後的安裝確認由你在手機上完成。</p>${inApp()?'<div class="notice">目前已在 APP 模式中開啟。</div>':''}${ios()?apple+android:android+apple}<div class="notice">請以後固定從主畫面圖示開啟。更換瀏覽器、重新安裝或清除網站資料，可能需要還原帳本與重新輸入 AI Key。</div>`);
  }
  async function install(){
    if(inApp()){toast('目前已在 APP 模式中開啟');return;}
    if(!deferredPrompt){help();return;}
    if(busy)return;
    const prompt=deferredPrompt;deferredPrompt=null;busy=true;refresh();
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      toast(choice.outcome==='accepted'?'已接受安裝，請依手機提示完成':'已取消安裝，仍可繼續使用網頁');
    }catch{help();toast('請改用瀏覽器選單安裝');}
    finally{busy=false;refresh();}
  }
  function bind(){
    document.querySelectorAll('[data-install-app]').forEach(b=>b.onclick=install);
    document.querySelectorAll('[data-install-help]').forEach(b=>b.onclick=help);
    refresh();
  }
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;refresh();});
  window.addEventListener('appinstalled',()=>{installed=true;deferredPrompt=null;refresh();toast('日常有餘已安裝，可從主畫面開啟');});
  standalone.addEventListener?.('change',refresh);
  return {button,panel,bind};
}
