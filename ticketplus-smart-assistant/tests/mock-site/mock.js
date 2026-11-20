// 模擬網站共用腳本：記錄非使用者（程式）觸發的點擊，供測試確認外掛從未點擊網站按鈕
(function(){
  document.addEventListener('click', function(e){
    if (!e.isTrusted) {
      var n = parseInt(document.body.getAttribute('data-untrusted-clicks')||'0',10)+1;
      document.body.setAttribute('data-untrusted-clicks', String(n));
    }
  }, true);
  // +/- 計數器
  document.querySelectorAll('.counter').forEach(function(c){
    var v = c.querySelector('.count'); var max = parseInt(c.getAttribute('data-max')||'4',10);
    c.querySelector('.btn-minus').addEventListener('click', function(){ v.textContent = Math.max(0, +v.textContent-1); });
    c.querySelector('.btn-plus').addEventListener('click', function(){ v.textContent = Math.min(max, +v.textContent+1); });
  });
  // 最終按鈕：記錄被點擊（測試需確認外掛從未觸發）
  document.querySelectorAll('[data-final]').forEach(function(b){
    b.addEventListener('click', function(e){ document.body.setAttribute('data-final-clicked', e.isTrusted ? 'user' : 'script'); });
  });
})();
