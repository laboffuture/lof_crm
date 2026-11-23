function signOut(msg) {
  stopLmsPolling();
  timers.forEach(clearInterval);
  timers = [];
  // drop everything the previous user could see before showing the sign-in screen
  S = null;
  S_sel = {};
  Object.keys(snap).forEach(function (k) {
    snap[k] = new Map();
  });
  snapSet = {};
  loginScreen(msg);
}
var pendingPw = null; // kept in memory only between "sign in" and the forced password change
// ---------------- sign-in screens (final design "LOF CRM Login v3"): a dark starry page with an orbiting satellite, a
// meteor and a planet horizon; the header with the logo and "Need help?"; the sign-in card in a glowing animated border
// on the left; on the right the dotted map with the animated route of our centres (Jaipur → Dubai → Chennai →
// Coimbatore → Mumbai), the headline and the enquiry-to-enrolment journey; the footer lists the roles.
// Phones: header, a smaller map, then the card. The same shell is used for sign-in, the two-step code, password reset
// and the forced password change. Stars, route and animations are copied from the design file.
var LB_ANIM =
  "@property --lof-a{syntax:'<angle>';inherits:false;initial-value:0deg}\n@keyframes lof-spin{to{--lof-a:360deg}}\n.lof-beam{background:conic-gradient(from var(--lof-a),rgba(142,177,242,0) 0deg,rgba(142,177,242,0) 230deg,rgba(142,177,242,.9) 290deg,#ffffff 318deg,rgba(213,58,40,.95) 340deg,rgba(213,58,40,0) 360deg),rgba(255,255,255,.14);animation:lof-spin 6s linear infinite}\n\n@keyframes lof-rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}\n@keyframes lof-fade{from{opacity:0}to{opacity:1}}\n.lof-rise{animation:lof-rise .9s cubic-bezier(.2,.7,.2,1) both}\n.lof-fade{animation:lof-fade 1.4s ease both}\n.lof-d1{animation-delay:.1s}.lof-d2{animation-delay:.35s}.lof-d3{animation-delay:.55s}.lof-d4{animation-delay:.75s}\n\n@keyframes lof-flow{0%{left:-23px;opacity:0}6%{opacity:1}84%{left:calc(100% - 23px);opacity:1}96%,100%{left:calc(100% - 23px);opacity:0}}\n.lof-flow{animation:lof-flow 5s cubic-bezier(.45,0,.55,1) infinite}\n@keyframes lof-arrive{0%,82%{box-shadow:0 0 0 0 rgba(213,58,40,0)}88%{box-shadow:0 0 0 8px rgba(213,58,40,.4)}100%{box-shadow:0 0 0 14px rgba(213,58,40,0)}}\n.lof-arrive{animation:lof-arrive 5s ease-out infinite}\n\n@keyframes lof-twinkle{0%,100%{opacity:.15}50%{opacity:.95}}\n.lof-tw1{animation:lof-twinkle 3.2s ease-in-out infinite}\n.lof-tw2{animation:lof-twinkle 4.6s ease-in-out 1.2s infinite}\n.lof-tw3{animation:lof-twinkle 5.8s ease-in-out 2.4s infinite}\n@keyframes lof-rot{to{transform:rotate(360deg)}}\n@keyframes lof-rot-rev{to{transform:rotate(-360deg)}}\n.lof-orbit{transform-origin:600px 600px;animation:lof-rot 48s linear infinite}\n.lof-orbit2{transform-origin:600px 600px;animation:lof-rot-rev 80s linear infinite}\n@keyframes lof-blink{0%,92%,100%{opacity:.25}96%{opacity:1}}\n.lof-blink{animation:lof-blink 2.4s ease-in-out infinite}\n@keyframes lof-meteor{0%,72%{transform:translate(0,0) rotate(-24deg);opacity:0}74%{opacity:1}84%,100%{transform:translate(-520px,232px) rotate(-24deg);opacity:0}}\n.lof-meteor{animation:lof-meteor 11s ease-in 3s infinite}\n\n@keyframes lof-trail1{0%,2%{stroke-dashoffset:379;opacity:1}20%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:379;opacity:0}}\n@keyframes lof-comet1{0%,1.8%{stroke-dashoffset:26;opacity:0}2%{stroke-dashoffset:26;opacity:1}20%{stroke-dashoffset:-379;opacity:1}20.3%,100%{stroke-dashoffset:-379;opacity:0}}\n.lof-trail1{stroke-dasharray:379 379;animation:lof-trail1 var(--lof-t) linear infinite}\n.lof-comet1{stroke-dasharray:26 431;animation:lof-comet1 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail2{0%,26%{stroke-dashoffset:523;opacity:1}46%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:523;opacity:0}}\n@keyframes lof-comet2{0%,25.8%{stroke-dashoffset:26;opacity:0}26%{stroke-dashoffset:26;opacity:1}46%{stroke-dashoffset:-523;opacity:1}46.3%,100%{stroke-dashoffset:-523;opacity:0}}\n.lof-trail2{stroke-dasharray:523 523;animation:lof-trail2 var(--lof-t) linear infinite}\n.lof-comet2{stroke-dasharray:26 575;animation:lof-comet2 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail3{0%,52%{stroke-dashoffset:81;opacity:1}58%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:81;opacity:0}}\n@keyframes lof-comet3{0%,51.8%{stroke-dashoffset:26;opacity:0}52%{stroke-dashoffset:26;opacity:1}58%{stroke-dashoffset:-81;opacity:1}58.3%,100%{stroke-dashoffset:-81;opacity:0}}\n.lof-trail3{stroke-dasharray:81 81;animation:lof-trail3 var(--lof-t) linear infinite}\n.lof-comet3{stroke-dasharray:26 133;animation:lof-comet3 var(--lof-t) ease-in-out infinite}\n@keyframes lof-trail4{0%,64%{stroke-dashoffset:177;opacity:1}74%,94%{stroke-dashoffset:0;opacity:1}99%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:177;opacity:0}}\n@keyframes lof-comet4{0%,63.8%{stroke-dashoffset:26;opacity:0}64%{stroke-dashoffset:26;opacity:1}74%{stroke-dashoffset:-177;opacity:1}74.3%,100%{stroke-dashoffset:-177;opacity:0}}\n.lof-trail4{stroke-dasharray:177 177;animation:lof-trail4 var(--lof-t) linear infinite}\n.lof-comet4{stroke-dasharray:26 229;animation:lof-comet4 var(--lof-t) ease-in-out infinite}\n@keyframes lof-on-jaipur{0%,94%{opacity:1}99%,100%{opacity:.75}}\n@keyframes lof-ping-jaipur{0%,0%{transform:scale(.6);opacity:0}0.1%{transform:scale(.6);opacity:.9}7%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-jaipur{animation:lof-on-jaipur var(--lof-t) linear infinite}.lof-ping-jaipur{transform-box:fill-box;transform-origin:center;animation:lof-ping-jaipur var(--lof-t) ease-out infinite}\n@keyframes lof-on-dubai{0%,19.5%{opacity:.4}20%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-dubai{0%,19.9%{transform:scale(.6);opacity:0}20.1%{transform:scale(.6);opacity:.9}27%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-dubai{animation:lof-on-dubai var(--lof-t) linear infinite}.lof-ping-dubai{transform-box:fill-box;transform-origin:center;animation:lof-ping-dubai var(--lof-t) ease-out infinite}\n@keyframes lof-on-mumbai{0%,73.5%{opacity:.4}74%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-mumbai{0%,73.9%{transform:scale(.6);opacity:0}74.1%{transform:scale(.6);opacity:.9}81%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-mumbai{animation:lof-on-mumbai var(--lof-t) linear infinite}.lof-ping-mumbai{transform-box:fill-box;transform-origin:center;animation:lof-ping-mumbai var(--lof-t) ease-out infinite}\n@keyframes lof-on-chennai{0%,45.5%{opacity:.4}46%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-chennai{0%,45.9%{transform:scale(.6);opacity:0}46.1%{transform:scale(.6);opacity:.9}53%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-chennai{animation:lof-on-chennai var(--lof-t) linear infinite}.lof-ping-chennai{transform-box:fill-box;transform-origin:center;animation:lof-ping-chennai var(--lof-t) ease-out infinite}\n@keyframes lof-on-coimbatore{0%,57.5%{opacity:.4}58%,94%{opacity:1}99%,100%{opacity:.4}}\n@keyframes lof-ping-coimbatore{0%,57.9%{transform:scale(.6);opacity:0}58.1%{transform:scale(.6);opacity:.9}65%,100%{transform:scale(2.6);opacity:0}}\n.lof-on-coimbatore{animation:lof-on-coimbatore var(--lof-t) linear infinite}.lof-ping-coimbatore{transform-box:fill-box;transform-origin:center;animation:lof-ping-coimbatore var(--lof-t) ease-out infinite}\n.lof-route{--lof-t:12s}\n\n@media (prefers-reduced-motion: reduce){\n.lof-route *,.lof-beam,.lof-rise,.lof-fade,.lof-flow,.lof-arrive,.lof-tw1,.lof-tw2,.lof-tw3,.lof-orbit,.lof-orbit2,.lof-blink,.lof-meteor{animation:none !important}\n.lof-route [class^=lof-comet],.lof-route [class^=lof-ping],.lof-flow,.lof-meteor{opacity:0 !important}\n.lof-route [class^=lof-trail]{stroke-dashoffset:0 !important}\n}";
var LB_STARS =
  '<circle class="lof-tw1" cx="466.3" cy="111.3" r="0.6" fill="#dbe6f7" opacity="0.29"></circle><circle cx="771.7" cy="269.9" r="0.6" fill="#dbe6f7" opacity="0.75"></circle><circle cx="309.2" cy="63.4" r="1.3" fill="#dbe6f7" opacity="0.29"></circle><circle cx="130.6" cy="313.3" r="0.7" fill="#dbe6f7" opacity="0.77"></circle><circle cx="908.1" cy="430.3" r="0.6" fill="#dbe6f7" opacity="0.57"></circle><circle class="lof-tw3" cx="571.2" cy="720.5" r="0.6" fill="#dbe6f7" opacity="0.56"></circle><circle cx="191.8" cy="309.3" r="0.7" fill="#dbe6f7" opacity="0.56"></circle><circle cx="806.8" cy="503.3" r="0.7" fill="#dbe6f7" opacity="0.57"></circle><circle cx="920.0" cy="274.8" r="0.7" fill="#dbe6f7" opacity="0.56"></circle><circle cx="891.4" cy="366.4" r="1.3" fill="#dbe6f7" opacity="0.68"></circle><circle class="lof-tw2" cx="670.5" cy="681.5" r="1.1" fill="#dbe6f7" opacity="0.41"></circle><circle cx="1143.9" cy="515.9" r="0.9" fill="#dbe6f7" opacity="0.3"></circle><circle cx="432.4" cy="365.4" r="1.1" fill="#dbe6f7" opacity="0.65"></circle><circle cx="414.6" cy="723.4" r="0.7" fill="#dbe6f7" opacity="0.53"></circle><circle cx="237.5" cy="252.4" r="1.6" fill="#dbe6f7" opacity="0.48"></circle><circle class="lof-tw1" cx="1385.3" cy="57.3" r="1.1" fill="#dbe6f7" opacity="0.44"></circle><circle cx="504.3" cy="366.5" r="1.6" fill="#dbe6f7" opacity="0.29"></circle><circle cx="134.8" cy="199.2" r="0.7" fill="#dbe6f7" opacity="0.28"></circle><circle cx="1010.1" cy="477.6" r="1.6" fill="#dbe6f7" opacity="0.41"></circle><circle cx="555.5" cy="493.5" r="0.6" fill="#dbe6f7" opacity="0.77"></circle><circle class="lof-tw3" cx="511.9" cy="450.9" r="1.6" fill="#dbe6f7" opacity="0.28"></circle><circle cx="1106.3" cy="95.5" r="0.9" fill="#dbe6f7" opacity="0.47"></circle><circle cx="1320.2" cy="366.4" r="0.8" fill="#dbe6f7" opacity="0.5"></circle><circle cx="791.2" cy="651.9" r="1.3" fill="#dbe6f7" opacity="0.73"></circle><circle cx="400.9" cy="306.5" r="1.1" fill="#dbe6f7" opacity="0.63"></circle><circle class="lof-tw2" cx="547.8" cy="170.3" r="0.7" fill="#dbe6f7" opacity="0.35"></circle><circle cx="334.0" cy="172.2" r="1.6" fill="#dbe6f7" opacity="0.71"></circle><circle cx="262.6" cy="208.1" r="0.8" fill="#dbe6f7" opacity="0.48"></circle><circle cx="531.7" cy="418.0" r="0.8" fill="#dbe6f7" opacity="0.63"></circle><circle cx="742.3" cy="455.8" r="0.6" fill="#dbe6f7" opacity="0.5"></circle><circle class="lof-tw1" cx="1254.2" cy="702.5" r="1.3" fill="#dbe6f7" opacity="0.47"></circle><circle cx="567.5" cy="355.4" r="1.3" fill="#dbe6f7" opacity="0.28"></circle><circle cx="97.0" cy="154.1" r="0.8" fill="#dbe6f7" opacity="0.31"></circle><circle cx="865.0" cy="75.6" r="0.8" fill="#dbe6f7" opacity="0.55"></circle><circle cx="1366.5" cy="452.9" r="0.7" fill="#dbe6f7" opacity="0.73"></circle><circle class="lof-tw3" cx="884.3" cy="109.6" r="1" fill="#dbe6f7" opacity="0.78"></circle><circle cx="867.3" cy="349.9" r="0.7" fill="#dbe6f7" opacity="0.72"></circle><circle cx="1430.1" cy="343.9" r="1.6" fill="#dbe6f7" opacity="0.42"></circle><circle cx="207.5" cy="553.3" r="1" fill="#dbe6f7" opacity="0.51"></circle><circle cx="996.6" cy="381.1" r="0.9" fill="#dbe6f7" opacity="0.77"></circle><circle class="lof-tw2" cx="760.7" cy="108.2" r="0.6" fill="#dbe6f7" opacity="0.67"></circle><circle cx="429.2" cy="474.5" r="0.7" fill="#dbe6f7" opacity="0.63"></circle><circle cx="376.0" cy="270.6" r="0.8" fill="#dbe6f7" opacity="0.45"></circle><circle cx="320.8" cy="399.7" r="1.1" fill="#dbe6f7" opacity="0.6"></circle><circle cx="883.0" cy="581.8" r="0.9" fill="#dbe6f7" opacity="0.69"></circle><circle class="lof-tw1" cx="1178.4" cy="546.0" r="0.9" fill="#dbe6f7" opacity="0.36"></circle><circle cx="709.6" cy="539.5" r="0.6" fill="#dbe6f7" opacity="0.68"></circle><circle cx="680.0" cy="142.9" r="1.1" fill="#dbe6f7" opacity="0.5"></circle><circle cx="1349.3" cy="729.2" r="1.1" fill="#dbe6f7" opacity="0.29"></circle><circle cx="147.1" cy="346.9" r="1.1" fill="#dbe6f7" opacity="0.36"></circle><circle class="lof-tw3" cx="898.7" cy="664.4" r="0.6" fill="#dbe6f7" opacity="0.51"></circle><circle cx="940.3" cy="590.1" r="0.7" fill="#dbe6f7" opacity="0.71"></circle><circle cx="172.7" cy="286.7" r="0.9" fill="#dbe6f7" opacity="0.51"></circle><circle cx="257.1" cy="582.4" r="1.1" fill="#dbe6f7" opacity="0.3"></circle><circle cx="1362.5" cy="532.7" r="1.6" fill="#dbe6f7" opacity="0.47"></circle><circle class="lof-tw2" cx="1363.4" cy="534.9" r="0.8" fill="#dbe6f7" opacity="0.8"></circle><circle cx="39.7" cy="436.0" r="1.6" fill="#dbe6f7" opacity="0.69"></circle><circle cx="210.5" cy="610.0" r="1.6" fill="#dbe6f7" opacity="0.61"></circle><circle cx="504.6" cy="404.9" r="0.8" fill="#dbe6f7" opacity="0.26"></circle><circle cx="1151.1" cy="536.1" r="0.7" fill="#dbe6f7" opacity="0.54"></circle><circle class="lof-tw1" cx="1344.4" cy="320.2" r="0.9" fill="#dbe6f7" opacity="0.7"></circle><circle cx="303.9" cy="185.9" r="1" fill="#dbe6f7" opacity="0.53"></circle><circle cx="1099.7" cy="240.6" r="1.3" fill="#dbe6f7" opacity="0.71"></circle><circle cx="87.7" cy="546.1" r="1.6" fill="#dbe6f7" opacity="0.61"></circle><circle cx="1173.7" cy="381.4" r="0.8" fill="#dbe6f7" opacity="0.54"></circle><circle class="lof-tw3" cx="753.8" cy="13.8" r="1.6" fill="#dbe6f7" opacity="0.68"></circle><circle cx="876.3" cy="572.7" r="0.8" fill="#dbe6f7" opacity="0.34"></circle><circle cx="681.8" cy="535.2" r="0.6" fill="#dbe6f7" opacity="0.43"></circle><circle cx="746.4" cy="409.9" r="0.7" fill="#dbe6f7" opacity="0.74"></circle><circle cx="81.8" cy="141.2" r="0.6" fill="#dbe6f7" opacity="0.67"></circle><circle class="lof-tw2" cx="731.1" cy="414.6" r="0.7" fill="#dbe6f7" opacity="0.49"></circle><circle cx="882.0" cy="373.1" r="0.9" fill="#dbe6f7" opacity="0.63"></circle><circle cx="651.4" cy="393.6" r="1.6" fill="#dbe6f7" opacity="0.53"></circle><circle cx="356.6" cy="386.1" r="1" fill="#dbe6f7" opacity="0.76"></circle><circle cx="1285.6" cy="149.5" r="1.6" fill="#dbe6f7" opacity="0.33"></circle><circle class="lof-tw1" cx="175.1" cy="326.3" r="0.7" fill="#dbe6f7" opacity="0.62"></circle><circle cx="616.8" cy="157.0" r="1" fill="#dbe6f7" opacity="0.68"></circle><circle cx="1291.7" cy="114.0" r="1.1" fill="#dbe6f7" opacity="0.33"></circle><circle cx="1271.3" cy="714.0" r="0.9" fill="#dbe6f7" opacity="0.66"></circle><circle cx="135.5" cy="653.1" r="0.8" fill="#dbe6f7" opacity="0.79"></circle>';
var LB_ROUTE =
  '<path d="M466.9 42.2 Q284 -18 100.6 76.2" stroke="#2F3E62" stroke-width="1.2" stroke-dasharray="3 5" fill="none"></path>\n<path class="lof-trail1" d="M466.9 42.2 Q284 -18 100.6 76.2" stroke="#4A7BD6" stroke-width="1.6" fill="none"></path>\n<path class="lof-comet1" d="M466.9 42.2 Q284 -18 100.6 76.2" stroke="#8EB1F2" stroke-width="9" stroke-linecap="round" fill="none" opacity="0" stroke-opacity=".3"></path>\n<path class="lof-comet1" d="M466.9 42.2 Q284 -18 100.6 76.2" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0"></path>\n<path d="M100.6 76.2 Q340 60 546.9 305.8" stroke="#2F3E62" stroke-width="1.2" stroke-dasharray="3 5" fill="none"></path>\n<path class="lof-trail2" d="M100.6 76.2 Q340 60 546.9 305.8" stroke="#4A7BD6" stroke-width="1.6" fill="none"></path>\n<path class="lof-comet2" d="M100.6 76.2 Q340 60 546.9 305.8" stroke="#8EB1F2" stroke-width="9" stroke-linecap="round" fill="none" opacity="0" stroke-opacity=".3"></path>\n<path class="lof-comet2" d="M100.6 76.2 Q340 60 546.9 305.8" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0"></path>\n<path d="M546.9 305.8 Q540 350 487.8 343.7" stroke="#2F3E62" stroke-width="1.2" stroke-dasharray="3 5" fill="none"></path>\n<path class="lof-trail3" d="M546.9 305.8 Q540 350 487.8 343.7" stroke="#4A7BD6" stroke-width="1.6" fill="none"></path>\n<path class="lof-comet3" d="M546.9 305.8 Q540 350 487.8 343.7" stroke="#8EB1F2" stroke-width="9" stroke-linecap="round" fill="none" opacity="0" stroke-opacity=".3"></path>\n<path class="lof-comet3" d="M546.9 305.8 Q540 350 487.8 343.7" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0"></path>\n<path d="M487.8 343.7 Q405 290 415 194.2" stroke="#2F3E62" stroke-width="1.2" stroke-dasharray="3 5" fill="none"></path>\n<path class="lof-trail4" d="M487.8 343.7 Q405 290 415 194.2" stroke="#4A7BD6" stroke-width="1.6" fill="none"></path>\n<path class="lof-comet4" d="M487.8 343.7 Q405 290 415 194.2" stroke="#8EB1F2" stroke-width="9" stroke-linecap="round" fill="none" opacity="0" stroke-opacity=".3"></path>\n<path class="lof-comet4" d="M487.8 343.7 Q405 290 415 194.2" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none" opacity="0"></path>\n<circle class="lof-ping-jaipur" cx="466.9" cy="42.2" r="10" stroke="#8EB1F2" stroke-width="2" fill="none" opacity="0"></circle>\n<g class="lof-on-jaipur"><circle cx="466.9" cy="42.2" r="13" fill="#1D4087" opacity=".28"></circle><circle cx="466.9" cy="42.2" r="6" fill="#ffffff"></circle><circle cx="466.9" cy="42.2" r="2.5" fill="#1D4087"></circle><text x="482.9" y="38" text-anchor="start" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600">Jaipur</text><text x="482.9" y="52" text-anchor="start" fill="#8EB1F2" font-family="Inter,system-ui,sans-serif" font-size="9.5" font-weight="500">Where it began</text></g>\n<circle class="lof-ping-dubai" cx="100.6" cy="76.2" r="10" stroke="#8EB1F2" stroke-width="2" fill="none" opacity="0"></circle>\n<g class="lof-on-dubai"><circle cx="100.6" cy="76.2" r="13" fill="#1D4087" opacity=".28"></circle><circle cx="100.6" cy="76.2" r="6" fill="#ffffff"></circle><circle cx="100.6" cy="76.2" r="2.5" fill="#1D4087"></circle><text x="116.6" y="92" text-anchor="start" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600">Dubai</text><text x="116.6" y="106" text-anchor="start" fill="#8EB1F2" font-family="Inter,system-ui,sans-serif" font-size="9.5" font-weight="500">Well established</text></g>\n<circle class="lof-ping-mumbai" cx="415" cy="194.2" r="10" stroke="#8EB1F2" stroke-width="2" fill="none" opacity="0"></circle>\n<g class="lof-on-mumbai"><circle cx="415" cy="194.2" r="13" fill="#1D4087" opacity=".28"></circle><circle cx="415" cy="194.2" r="6" fill="#ffffff"></circle><circle cx="415" cy="194.2" r="2.5" fill="#1D4087"></circle><text x="431" y="192" text-anchor="start" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600">Mumbai</text><text x="431" y="206" text-anchor="start" fill="#8EB1F2" font-family="Inter,system-ui,sans-serif" font-size="9.5" font-weight="500">Newest centre</text></g>\n<circle class="lof-ping-chennai" cx="546.9" cy="305.8" r="10" stroke="#8EB1F2" stroke-width="2" fill="none" opacity="0"></circle>\n<g class="lof-on-chennai"><circle cx="546.9" cy="305.8" r="13" fill="#1D4087" opacity=".28"></circle><circle cx="546.9" cy="305.8" r="6" fill="#ffffff"></circle><circle cx="546.9" cy="305.8" r="2.5" fill="#1D4087"></circle><text x="562.9" y="310.8" text-anchor="start" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600">Chennai</text></g>\n<circle class="lof-ping-coimbatore" cx="487.8" cy="343.7" r="10" stroke="#8EB1F2" stroke-width="2" fill="none" opacity="0"></circle>\n<g class="lof-on-coimbatore"><circle cx="487.8" cy="343.7" r="13" fill="#1D4087" opacity=".28"></circle><circle cx="487.8" cy="343.7" r="6" fill="#ffffff"></circle><circle cx="487.8" cy="343.7" r="2.5" fill="#1D4087"></circle><text x="471.8" y="348.7" text-anchor="end" fill="#ffffff" font-family="Inter,system-ui,sans-serif" font-size="13" font-weight="600">Coimbatore</text></g>';
function lbBrand() {
  return (
    '<div class="lb-brand"><span class="lb-logo-tile"><img class="lb-logo" src="/login-logo.png" alt="Lab of Future, Be Curious" width="480" height="135"></span>' +
    '<span class="lb-brand-sep" aria-hidden="true"></span><span class="lb-brand-sub">CRM &amp; Sales</span></div>'
  );
}
function lbScene() {
  return (
    '<svg class="lb-stars" aria-hidden="true" focusable="false" viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">' +
    LB_STARS +
    '</svg>' +
    '<div class="lb-meteor lof-meteor" aria-hidden="true"></div>' +
    '<div class="lb-planet" aria-hidden="true"></div>' +
    '<svg class="lb-orbits" aria-hidden="true" focusable="false" width="1200" height="1200" viewBox="0 0 1200 1200" fill="none">' +
    '<circle cx="600" cy="600" r="330" stroke="#22304E" stroke-width="1.2"/><circle cx="600" cy="600" r="450" stroke="#22304E" stroke-width="1.2" stroke-dasharray="2 8"/>' +
    '<g class="lof-orbit"><g transform="translate(930 600) rotate(90)"><circle r="16" fill="#8EB1F2" opacity=".12"/>' +
    '<rect x="-5" y="-7" width="10" height="14" rx="2" fill="#dbe6f7"/><rect x="-21" y="-4.5" width="13" height="9" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width="1"/>' +
    '<rect x="8" y="-4.5" width="13" height="9" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width="1"/><path d="M-8 0H-5M5 0H8M0 -7V-12" stroke="#dbe6f7" stroke-width="1.2"/>' +
    '<circle class="lof-blink" cx="0" cy="-13" r="2" fill="#D53A28"/></g></g>' +
    '<g class="lof-orbit2"><circle cx="600" cy="150" r="3.5" fill="#dbe6f7"/><circle cx="600" cy="150" r="9" fill="#8EB1F2" opacity=".15"/></g></svg>' +
    '<svg class="lb-sat-m" aria-hidden="true" focusable="false" width="390" height="200" viewBox="0 0 390 200"><g class="lof-sat"><g transform="translate(0 92) rotate(-8)">' +
    '<circle r="11" fill="#8EB1F2" opacity=".12"/><rect x="-3.5" y="-5" width="7" height="10" rx="1.5" fill="#dbe6f7"/>' +
    '<rect x="-15" y="-3" width="9" height="6" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width=".8"/><rect x="6" y="-3" width="9" height="6" rx="1" fill="#1D4087" stroke="#4A7BD6" stroke-width=".8"/>' +
    '<circle class="lof-blink" cx="0" cy="-8" r="1.6" fill="#D53A28"/></g></g></svg>'
  );
}
function lbContext() {
  var steps = ['Enquiry', 'First call', 'Counselling', 'Opportunity', 'Enrolled'];
  return (
    '<section class="lb-ctx" aria-label="About LOF CRM"><div class="lb-map">' +
    '<img class="lof-fade lof-d1" src="/login-map.svg" alt="" width="620" height="380">' +
    '<svg class="lof-route lof-fade lof-d2" role="img" aria-label="Lab of Future\'s growth: started in Jaipur, then Dubai, Chennai, Coimbatore and now Mumbai" viewBox="0 0 620 380" fill="none">' +
    LB_ROUTE +
    '</svg>' +
    '<div class="lb-hero lof-rise lof-d2"><h2>Every enquiry, from first call to <span>first class.</span></h2>' +
    '<div class="lb-journey lof-rise lof-d4"><div class="lb-j-line"><span class="lof-flow" aria-hidden="true"></span></div><ol>' +
    steps
      .map(function (s, i) {
        return (
          '<li' +
          (i === steps.length - 1 ? ' class="last"' : '') +
          '><span class="lb-j-dot' +
          (i === steps.length - 1 ? ' lof-arrive' : '') +
          '"></span><span class="lb-j-label">' +
          s +
          '</span></li>'
        );
      })
      .join('') +
    '</ol></div></div></div></section>'
  );
}
function lbStyles() {
  if (document.getElementById('lbStyle')) return;
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap';
  document.head.appendChild(l);
  var st = document.createElement('style');
  st.id = 'lbStyle';
  var F = 'Inter,system-ui,-apple-system,"Segoe UI",sans-serif';
  st.textContent = [
    '.lb-shell{position:relative;min-height:100vh;min-height:100dvh;width:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;font-family:' +
      F +
      ';color:#B6C1D8;color-scheme:light;' +
      'background:radial-gradient(620px 540px at 19% 56%,rgba(42,91,176,.5),rgba(42,91,176,0) 70%),radial-gradient(980px 760px at 70% 46%,rgba(29,64,135,.26),rgba(29,64,135,0) 70%),#0A1120}',
    '.lb-shell :focus-visible{outline:2px solid #4A7BD6;outline-offset:2px}',
    '.lb-stars{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
    '.lb-meteor{position:absolute;left:1180px;top:70px;width:140px;height:2px;border-radius:2px;background:linear-gradient(90deg,#fff,rgba(142,177,242,0));opacity:0;pointer-events:none}',
    '.lb-planet{position:absolute;left:50%;top:calc(100% - 150px);width:3200px;height:3200px;margin-left:-1600px;border-radius:50%;pointer-events:none;' +
      'background:radial-gradient(circle at 50% 0%,#1A3F80 0%,#0F2550 6%,#0A1120 18%);box-shadow:0 -1px 0 rgba(190,210,248,.55),0 -10px 30px rgba(142,177,242,.28),0 -40px 120px rgba(74,123,214,.22)}',
    '.lb-orbits{position:absolute;left:-300px;top:-128px;pointer-events:none}.lb-sat-m{display:none}',
    // header
    '.lb-top{position:relative;display:flex;justify-content:space-between;align-items:center;gap:16px;padding:28px 80px}',
    '.lb-brand{display:flex;align-items:center;gap:12px}',
    '.lb-logo-tile{background:#fff;border-radius:12px;padding:7px 12px;display:flex;align-items:center;box-shadow:0 8px 24px rgba(3,8,20,.45)}.lb-logo{height:38px;width:auto;display:block}',
    '.lb-brand-sep{width:1px;height:28px;background:#2F3E62}.lb-brand-sub{font-size:14px;font-weight:600;color:#fff;letter-spacing:.01em;white-space:nowrap}',
    '.lb-help{font:14px ' +
      F +
      ';color:#B6C1D8;padding:10px 16px;border:1px solid #2F3E62;border-radius:10px;background:rgba(255,255,255,.03);cursor:pointer}.lb-help:hover{color:#fff}',
    // main: the card on the left, the map on the right
    '.lb-main{position:relative;flex:1;display:flex;flex-wrap:wrap;align-items:center;gap:40px 48px;padding:0 56px 24px 80px}',
    '.lb-left{flex:0 1 440px;min-width:0;display:flex;flex-direction:column;gap:18px}',
    '.lb-frost{padding:1.5px;border-radius:22px;box-shadow:0 30px 80px rgba(3,8,20,.55),0 0 70px rgba(74,123,214,.22)}',
    '.lb-card{margin:0;background:#fff;border-radius:20.5px;padding:40px;display:flex;flex-direction:column;gap:22px;color:#0F1B33;font-family:' +
      F +
      '}',
    '.lb-head{display:flex;flex-direction:column;gap:8px}',
    '.lb-eyebrow{font:600 11px ' + F + ';letter-spacing:.12em;text-transform:uppercase;color:#1D4087}',
    '.lb-h1{margin:0;font-size:32px;line-height:1.15;font-weight:600;color:#0F2550}',
    '.lb-sub{margin:0;font-size:15px;line-height:1.5;color:#66708A}',
    '.lb-fields{display:flex;flex-direction:column;gap:16px}',
    '.lb-f,.lb-card .f{display:flex;flex-direction:column;gap:6px}',
    '.lb-f label,.lb-card .f label{font-size:13px;font-weight:500;color:#0F1B33}',
    '.lb-labrow{display:flex;justify-content:space-between;align-items:baseline;gap:12px}',
    '.lb-in,.lb-card .f input{width:100%;box-sizing:border-box;height:48px;border:1px solid #CFD7E4;border-radius:10px;padding:0 14px;font:15px ' +
      F +
      ';color:#0F1B33;background:#fff;transition:border-color .2s,box-shadow .2s}',
    '.lb-in:hover,.lb-card .f input:hover{border-color:#A0A8BA}',
    '.lb-in:focus,.lb-card .f input:focus{border-color:#1D4087;box-shadow:0 0 0 4px rgba(29,64,135,.15);outline:none}',
    '.lb-card .f input[readonly]{background:#F5F7FB}',
    '.lb-pw{position:relative}.lb-pw .lb-in{padding-right:76px}',
    '.lb-eye{position:absolute;right:6px;top:7px;height:34px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:#1D4087;font:500 13px ' +
      F +
      ';cursor:pointer}',
    '.lb-check{display:flex;align-items:center;gap:10px;font-size:14px;color:#0F1B33;cursor:pointer}.lb-check input{width:18px;height:18px;margin:0;accent-color:#1D4087}',
    '.lb-btn{height:50px;width:100%;border:0;border-radius:10px;background:#1D4087;color:#fff;font:600 15px ' +
      F +
      ';cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .15s,box-shadow .2s,filter .2s}',
    '.lb-btn svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.lb-btn:hover{filter:brightness(1.08);box-shadow:0 10px 24px rgba(29,64,135,.45);transform:translateY(-1px)}.lb-btn:disabled{opacity:.65;cursor:progress;transform:none}',
    '.lb-link{color:#1D4087;text-decoration:none;font-weight:500;font-size:13px;cursor:pointer}.lb-link:hover{text-decoration:underline}',
    '.lb-msg{padding:12px 14px;border-radius:10px;background:#EEF3FB;color:#0F2550;font-size:13px;line-height:1.5}',
    '.lb-err{font-size:13.5px;line-height:1.45;color:#b42318}.lb-err:empty{display:none}',
    '.lb-info{font-size:13px;color:#66708A}.lb-info:empty{display:none}',
    '.lb-foot{font-size:13px;color:#66708A}.lb-foot a{color:#1D4087!important}',
    '.lb-card .help{font-size:12.5px;color:#66708A}.lb-card .banner{margin:0}',
    '.lb-access{margin:0;padding:0 6px;font-size:13px;color:#8592AD}',
    '.lb-helpbox{margin:0;padding:12px 14px;border-radius:12px;border:1px solid #2F3E62;background:rgba(255,255,255,.04);font-size:13px;line-height:1.5;color:#B6C1D8}.lb-helpbox b{color:#fff}.lb-helpbox[hidden]{display:none}',
    // right: map, route, headline and journey
    '.lb-ctx{flex:1 1 560px;min-width:0;display:flex;justify-content:center}',
    '.lb-map{position:relative;width:100%;max-width:900px;aspect-ratio:620/380}',
    '.lb-map img{position:absolute;inset:0;width:100%;height:100%;display:block;-webkit-mask-image:radial-gradient(ellipse 72% 72% at 55% 45%,#000 45%,rgba(0,0,0,0) 100%);mask-image:radial-gradient(ellipse 72% 72% at 55% 45%,#000 45%,rgba(0,0,0,0) 100%)}',
    '.lof-route{position:absolute;inset:0;width:100%;height:100%;overflow:visible}',
    '.lb-hero{position:absolute;left:8%;top:44%;width:50%;display:flex;flex-direction:column;gap:22px}',
    '.lb-hero h2{margin:0;font-size:clamp(28px,3vw,46px);line-height:1.06;font-weight:600;color:#fff;letter-spacing:-.015em}.lb-hero h2 span{color:#EE5A46}',
    '.lb-journey{position:relative;max-width:460px}',
    '.lb-j-line{position:absolute;left:6px;right:6px;top:5px;height:2px;background:#2F3E62;border-radius:2px}',
    '.lb-j-line .lof-flow{position:absolute;top:-4px;width:46px;height:10px;border-radius:10px;background:radial-gradient(closest-side,#fff,rgba(142,177,242,.7) 45%,rgba(142,177,242,0))}',
    '.lb-journey ol{position:relative;list-style:none;margin:0;padding:0;display:flex;justify-content:space-between}',
    '.lb-journey li{display:flex;flex-direction:column;align-items:center;gap:10px}.lb-journey li:first-child{align-items:flex-start}.lb-journey li.last{align-items:flex-end}',
    '.lb-j-dot{width:12px;height:12px;border-radius:50%;background:#4A7BD6;box-shadow:0 0 0 4px #0F1A33}.lb-journey li.last .lb-j-dot{background:#D53A28}',
    '.lb-j-label{font-size:13px;font-weight:500;color:#B6C1D8}.lb-journey li.last .lb-j-label{font-weight:600;color:#fff}',
    // footer: the roles
    '.lb-page-foot{position:relative;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 24px;padding:18px 80px;border-top:1px solid rgba(133,146,173,.16);background:rgba(6,12,24,.45)}',
    '.lb-roles{display:flex;flex-wrap:wrap;align-items:center;gap:8px}',
    '.lb-roles-t{font:600 11px ' + F + ';letter-spacing:.1em;text-transform:uppercase;color:#8592AD;margin-right:6px}',
    '.lb-role{font-size:13px;color:#B6C1D8;padding:5px 12px;border:1px solid rgba(133,146,173,.25);border-radius:999px;background:rgba(255,255,255,.03)}',
    '.lb-copy{font-size:13px;color:#8592AD}',
    LB_ANIM,
    '@keyframes lof-sat{0%{transform:translate(-40px,0)}100%{transform:translate(430px,-60px)}}.lof-sat{animation:lof-sat 26s linear infinite}',
    '@media (prefers-reduced-motion:reduce){.lof-sat{animation:none!important}}',
    '@media (max-width:1180px){.lb-top{padding:24px 40px}.lb-main{padding:0 32px 24px 40px}.lb-page-foot{padding:16px 40px}}',
    // phones and narrow windows: header, a smaller map, then the card
    '@media (max-width:900px){' +
      '.lb-shell{gap:12px;padding:18px 16px;background:radial-gradient(420px 460px at 50% 70%,rgba(42,91,176,.5),rgba(42,91,176,0) 70%),radial-gradient(420px 300px at 50% 22%,rgba(29,64,135,.28),rgba(29,64,135,0) 70%),#0A1120}' +
      '.lb-orbits,.lb-meteor,.lb-hero,.lb-page-foot,.lb-brand-sep{display:none}' +
      '.lb-sat-m{display:block;position:absolute;left:0;top:0;pointer-events:none}' +
      '.lb-planet{top:auto;bottom:-1346px;width:1400px;height:1400px;margin-left:-700px;background:radial-gradient(circle at 50% 0%,#1A3F80 0%,#0F2550 8%,#0A1120 22%);box-shadow:0 -1px 0 rgba(190,210,248,.55),0 -10px 30px rgba(142,177,242,.28),0 -30px 80px rgba(74,123,214,.22)}' +
      '.lb-top{padding:0 4px}.lb-brand{gap:10px}.lb-logo-tile{border-radius:10px;padding:6px 10px}.lb-logo{height:30px}.lb-brand-sub{font-size:13px}' +
      '.lb-help{min-height:44px;padding:0 12px}' +
      '.lb-main{flex:none;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:12px;padding:0}' +
      '.lb-ctx{order:-1;flex:none}.lb-map{width:340px;max-width:100%}' +
      '.lb-left{flex:none;gap:12px}.lb-frost{border-radius:20px;box-shadow:0 24px 60px rgba(3,8,20,.55),0 0 60px rgba(74,123,214,.22)}' +
      '.lb-card{border-radius:18.5px;padding:22px;gap:16px}.lb-head{gap:4px}.lb-eyebrow{font-size:10px}.lb-h1{font-size:24px;line-height:1.2}.lb-sub{display:none}' +
      '.lb-fields{gap:14px}.lb-in,.lb-card .f input{font-size:16px}.lb-eye{right:4px;top:2px;height:44px;padding:0 12px;font-size:14px}' +
      '.lb-check input{width:20px;height:20px}.lb-btn{font-size:16px}' +
      '.lb-access{text-align:center;line-height:1.5}' +
      '}',
  ].join('\n');
  document.head.appendChild(st);
}
function authShell(cardHtml) {
  lbStyles();
  // the sign-in screens keep their own colours; the CRM applies the user's own theme again after sign-in
  document.documentElement.removeAttribute('data-theme');
  var roles = ['Counsellor', 'Reception', 'Admissions Head', 'Centre Administrator', 'Management'];
  document.getElementById('app').innerHTML =
    '<div class="lb-shell" id="lbRoot">' +
    lbScene() +
    '<header class="lb-top lof-fade">' +
    lbBrand() +
    '<button type="button" class="lb-help" id="lbHelp" aria-expanded="false" aria-controls="lbHelpBox"><span class="lb-help-l">Need help?</span></button></header>' +
    '<main class="lb-main"><div class="lb-left">' +
    '<div class="lb-frost lof-beam lof-rise lof-d1">' +
    cardHtml +
    '</div>' +
    '<p class="lb-helpbox" id="lbHelpBox" hidden>Forgot your password? Use <b>Forgot password?</b> on the sign-in form to get a 6-digit reset code. ' +
    'For a new account, a locked account or a lost authenticator, ask your Centre Administrator.</p>' +
    '<p class="lb-access lof-rise lof-d3">No access yet? Ask your Centre Administrator.</p></div>' +
    lbContext() +
    '</main>' +
    '<footer class="lb-page-foot lof-fade lof-d3"><div class="lb-roles"><span class="lb-roles-t">Built for every desk</span>' +
    roles
      .map(function (r) {
        return '<span class="lb-role">' + r + '</span>';
      })
      .join('') +
    '</div>' +
    '<span class="lb-copy">© ' +
    new Date().getFullYear() +
    ' Lab of Future · Top Rock Global Pvt Ltd</span></footer>' +
    '</div>';
  var hb = document.getElementById('lbHelp');
  if (window.matchMedia && window.matchMedia('(max-width:900px)').matches)
    hb.querySelector('.lb-help-l').textContent = 'Help';
  hb.addEventListener('click', function () {
    var box = document.getElementById('lbHelpBox'),
      open = box.hidden;
    box.hidden = !open;
    hb.setAttribute('aria-expanded', String(open));
  });
}
var LB_ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
function authCard(sub, msg, inner, btn, foot) {
  authShell(
    '<form id="lofAuth" class="lb-card" novalidate>' +
      '<div class="lb-head"><span class="lb-eyebrow">LOF CRM · Staff sign in</span><h1 class="lb-h1">' +
      esc(sub) +
      '</h1></div>' +
      (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') +
      '<div class="lb-fields">' +
      inner +
      '</div>' +
      '<div class="lb-err" id="lofErr" role="alert"></div>' +
      '<button class="lb-btn" type="submit">' +
      esc(btn) +
      '</button>' +
      (foot ? '<div class="lb-foot">' + foot + '</div>' : '') +
      '</form>',
  );
  var f = document.getElementById('lofAuth');
  var first = f.querySelector('input:not([type=hidden])');
  if (first) first.focus();
  return f;
}

function onSubmit(f, fn) {
  f.addEventListener(
    'submit',
    function (e) {
      e.preventDefault();
      e.stopPropagation();
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      Promise.resolve(fn(Object.fromEntries(new FormData(f).entries()), document.getElementById('lofErr')))
        .catch(function (x) {
          document.getElementById('lofErr').textContent = x.message;
        })
        .then(function () {
          if (document.body.contains(btn)) btn.disabled = false;
        });
    },
    true,
  );
}
function afterAuth(stage) {
  if (stage === 'password_change' || stage === 'mfa_setup') stageScreen(stage);
  else start();
}
function loginScreen(msg, needCode, remembered) {
  var f;
  if (needCode) {
    f = authCard(
      'Two-step verification',
      msg || 'Enter the 6-digit code from your authenticator app.',
      '<input type="hidden" name="email" value="' +
        esc(remembered.email) +
        '"><input type="hidden" name="password" value="' +
        esc(remembered.password) +
        '">' +
        '<div class="f"><label for="lc">Verification code</label><input id="lc" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required></div>',
      'Verify and Sign In',
      '',
    );
  } else {
    // Remember Me keeps only the e-mail address on this device – never the password
    var saved = LS.get('lof_login_email') || '';
    authShell(
      '<form id="lofAuth" class="lb-card" novalidate>' +
        '<div class="lb-head"><span class="lb-eyebrow">LOF CRM · Staff sign in</span><h1 class="lb-h1">Welcome back</h1><p class="lb-sub">Pick up your leads, admissions and payments where you left them.</p></div>' +
        (msg ? '<div class="lb-msg" role="status">' + esc(msg) + '</div>' : '') +
        '<div class="lb-fields">' +
        '<div class="lb-f"><label for="le">Work email</label>' +
        '<input class="lb-in" id="le" name="email" type="email" autocomplete="username" placeholder="name@laboffuture.com" required value="' +
        esc(saved) +
        '"></div>' +
        '<div class="lb-f"><div class="lb-labrow"><label for="lp">Password</label><a href="#" class="lb-link" id="linkForgotPw">Forgot password?</a></div>' +
        '<div class="lb-pw"><input class="lb-in" id="lp" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>' +
        '<button type="button" class="lb-eye" id="lbEye" aria-label="Show password" aria-pressed="false">Show</button></div></div>' +
        '<label class="lb-check"><input type="checkbox" name="remember" id="lbRemember"' +
        (saved ? ' checked' : '') +
        '>Remember my e-mail on this device</label>' +
        '</div>' +
        '<div class="lb-err" id="lofErr" role="alert"></div>' +
        '<button class="lb-btn" type="submit">Sign in' +
        LB_ARROW +
        '</button>' +
        '</form>',
    );
    f = document.getElementById('lofAuth');
    (saved ? document.getElementById('lp') : document.getElementById('le')).focus();
    document.getElementById('lbEye').addEventListener('click', function () {
      var pw = document.getElementById('lp'),
        show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show';
      this.setAttribute('aria-pressed', String(show));
      this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    document.getElementById('linkForgotPw').addEventListener('click', function (e) {
      e.preventDefault();
      forgotPasswordScreen('', document.getElementById('le').value.trim());
    });
  }

  onSubmit(f, function (d) {
    return req('POST', '/auth/login', { email: d.email, password: d.password, code: d.code }).then(function (r) {
      if (!needCode) LS.set('lof_login_email', d.remember ? String(d.email || '').trim() : null);
      if (r.mfaRequired) return loginScreen('', true, { email: d.email, password: d.password });
      pendingPw = r.stage === 'password_change' ? d.password : null;
      afterAuth(r.stage);
    });
  });
}

function forgotPasswordScreen(msg, emailPrefill) {
  var foot =
    '<a href="javascript:void(0)" id="linkBackToLogin" style="font-size:12.5px;color:var(--muted,#64748b);text-decoration:none;cursor:pointer">← Back to Sign In</a>';

  var f = authCard(
    'Self-Service Password Reset',
    msg || 'Enter your registered work e-mail address. We will verify your account and provide a 6-digit reset code.',
    '<div class="f"><label for="fpe">Work E-mail</label><input id="fpe" name="email" type="email" autocomplete="email" placeholder="name@example.com" value="' +
      esc(emailPrefill || '') +
      '" required autofocus></div>',
    'Send Verification Code',
    foot,
  );

  var backLink = document.getElementById('linkBackToLogin');
  if (backLink) {
    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      loginScreen();
    });
  }

  onSubmit(f, function (d, err) {
    var email = (d.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 0) {
      err.textContent = 'Please enter a valid work e-mail address.';
      return;
    }
    return req('POST', '/auth/forgot-password/request', { email: email }).then(function (res) {
      confirmResetPasswordScreen(email, res.message, res.devCode);
    });
  });
}

function confirmResetPasswordScreen(email, msg, devCode) {
  var foot =
    '<div style="display:flex;justify-content:space-between;font-size:12px">' +
    '<a href="javascript:void(0)" id="linkResend" style="color:var(--accent,#2563eb);text-decoration:none;cursor:pointer">Resend code</a>' +
    '<a href="javascript:void(0)" id="linkBackToLogin2" style="color:var(--muted,#64748b);text-decoration:none;cursor:pointer">Back to Sign In</a>' +
    '</div>';

  var devBanner = devCode
    ? '<div class="banner" style="margin:0;background:var(--ok-bg,#ecfdf5);color:var(--ok,#059669);border:1px solid var(--ok);font-size:12px">' +
      '<b>Verification Code:</b> <span class="mono" style="font-weight:700;font-size:14px;letter-spacing:1px">' +
      esc(devCode) +
      '</span><br>' +
      '<span class="xs" style="opacity:0.9">In development / testing mode, the code is provided directly here.</span></div>'
    : '';

  var f = authCard(
    'Set New Password',
    msg || 'A verification code has been sent for ' + esc(email) + '.',
    devBanner +
      '<input type="hidden" name="email" value="' +
      esc(email) +
      '">' +
      '<div class="f"><label for="rpc">6-Digit Verification Code</label><input id="rpc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="e.g. 123456" pattern="[0-9]{6}" required value="' +
      esc(devCode || '') +
      '"></div>' +
      '<div class="f"><label for="rpn">New Password</label><input id="rpn" name="next" type="password" autocomplete="new-password" placeholder="At least 10 characters" required></div>' +
      '<div class="f"><label for="rpn2">Confirm New Password</label><input id="rpn2" name="next2" type="password" autocomplete="new-password" placeholder="Re-enter new password" required>' +
      '<div class="help" style="margin-top:4px">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
    'Reset Password',
    foot,
  );

  var resendLink = document.getElementById('linkResend');
  if (resendLink) {
    resendLink.addEventListener('click', function (e) {
      e.preventDefault();
      req('POST', '/auth/forgot-password/request', { email: email })
        .then(function (res) {
          confirmResetPasswordScreen(email, 'New verification code sent.', res.devCode);
          if (typeof toast === 'function') toast('New verification code sent', 'ok');
        })
        .catch(function (err) {
          document.getElementById('lofErr').textContent = err.message;
        });
    });
  }

  var backLink = document.getElementById('linkBackToLogin2');
  if (backLink) {
    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      loginScreen();
    });
  }

  onSubmit(f, function (d, err) {
    if (d.next !== d.next2) {
      err.textContent = 'The passwords do not match';
      return;
    }
    return req('POST', '/auth/forgot-password/confirm', {
      email: d.email,
      code: (d.code || '').trim(),
      next: d.next,
    }).then(function (res) {
      loginScreen(res.message || 'Password successfully reset! Please sign in with your new password.');
      if (typeof toast === 'function') toast('Password reset successfully', 'ok');
    });
  });
}
function stageScreen(stage, msg) {
  timers.forEach(clearInterval);
  if (stage === 'password_change') {
    var f = authCard(
      'Choose a new password',
      msg || 'Your password must be changed before you continue.',
      (pendingPw
        ? ''
        : '<div class="f"><label for="lp0">Current password</label><input id="lp0" name="current" type="password" autocomplete="current-password" required></div>') +
        '<div class="f"><label for="lp1">New password</label><input id="lp1" name="next" type="password" autocomplete="new-password" required></div><div class="f"><label for="lp2">Repeat new password</label><input id="lp2" name="next2" type="password" autocomplete="new-password" required><div class="help">At least 10 characters using three of: lower-case, upper-case, digits, symbols.</div></div>',
      'Save and continue',
    );
    onSubmit(f, function (d, err) {
      if (d.next !== d.next2) {
        err.textContent = 'The passwords do not match';
        return;
      }
      return req('POST', '/auth/change-password', { current: pendingPw || d.current, next: d.next }).then(function (r) {
        pendingPw = null;
        afterAuth(r.stage);
      });
    });
    return;
  }
  // Two-step verification setup
  authCard('Set up two-step verification', 'Loading…', '', 'Turn on');
  req('POST', '/auth/mfa/setup')
    .then(function (r) {
      var qrImg = '';
      try {
        if (window.qrcode) {
          var q = window.qrcode(0, 'M');
          q.addData(r.otpauth);
          q.make();
          qrImg =
            '<img alt="QR code for your authenticator app" src="' +
            q.createDataURL(5, 8) +
            '" style="width:200px;height:200px;align-self:center;image-rendering:pixelated;background:#fff;border-radius:6px">';
        }
      } catch (e) {}
      var f = authCard(
        'Set up two-step verification',
        msg ||
          'Your role requires a verification code at sign-in. Scan the QR code with Google Authenticator, Microsoft Authenticator or a similar app, then enter the 6-digit code.',
        qrImg +
          '<div class="f"><label for="ms">Or enter this setup key</label><input id="ms" readonly value="' +
          esc(r.secret.replace(/(.{4})/g, '$1 ').trim()) +
          '" class="mono"></div><div class="f"><label for="mc">6-digit code</label><input id="mc" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></div>',
        'Turn on and continue',
      );
      onSubmit(f, function (d) {
        return req('POST', '/auth/mfa/enable', { code: d.code }).then(function () {
          start();
        });
      });
    })
    .catch(function (e) {
      authCard('Two-step verification', e.message, '', 'Retry');
    });
}
