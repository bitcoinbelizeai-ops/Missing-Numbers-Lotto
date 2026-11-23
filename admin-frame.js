// Results Admin: refuse to run inside another website's frame (moved out of admin.html so a strict
// Content-Security-Policy can block inline scripts, Nov 23, 2026)
// This page only works on its own, never inside another website's frame
  if(window.self===window.top){document.getElementById('antiFrame').remove()}
  else{try{window.top.location=window.self.location}catch(e){}}
