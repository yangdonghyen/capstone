document.addEventListener("DOMContentLoaded", function () {
  const elements = document.querySelectorAll(".fade-in-element");

  elements.forEach((element, index) => {
    const textContent = element.textContent;
    element.innerHTML = ""; // 텍스트 내용 초기화

    // 각 글자마다 span 요소로 감싸서 추가
    for (const char of textContent) {
      const span = document.createElement("span");
      span.textContent = char;
      element.appendChild(span);
    }

    // 각 글자에 페이드 인 클래스 추가하여 순차적으로 페이드 인
    const spans = element.querySelectorAll("span");
    spans.forEach((span, index) => {
      setTimeout(() => {
        span.classList.add("fade-in");
      }, index * 80); // 0.1초 간격으로 페이드 인
    });
  });
});

$(document).ready(function () {
  // 클래스가 "scroll_on"인 모든 요소를 선택합니다.
  const $counters = $(".technical-section");

  // 노출 비율(%)과 애니메이션 반복 여부(true/false)를 설정합니다.
  const exposurePercentage = 100; // ex) 스크롤 했을 때 $counters 컨텐츠가 화면에 100% 노출되면 숫자가 올라갑니다.
  const loop = true; // 애니메이션 반복 여부를 설정합니다. (true로 설정할 경우, 요소가 화면에서 사라질 때 다시 숨겨집니다.)

  // 윈도우의 스크롤 이벤트를 모니터링합니다.
  $(window)
    .on("scroll", function () {
      // 각 "scroll_on" 클래스를 가진 요소에 대해 반복합니다.
      $counters.each(function () {
        const $el = $(this);

        // 요소의 위치 정보를 가져옵니다.
        const rect = $el[0].getBoundingClientRect();
        const winHeight = window.innerHeight; // 현재 브라우저 창의 높이
        const contentHeight = rect.bottom - rect.top; // 요소의 높이

        // 요소가 화면에 특정 비율만큼 노출될 때 처리합니다.
        if (
          rect.top <= winHeight - (contentHeight * exposurePercentage) / 100 &&
          rect.bottom >= (contentHeight * exposurePercentage) / 100
        ) {
          $el.addClass("active");
        }
        // 요소가 화면에서 완전히 사라졌을 때 처리합니다.
        if (loop && (rect.bottom <= 0 || rect.top >= window.innerHeight)) {
          $el.removeClass("active");
        }
      });
    })
    .scroll();
});
const socket = new WebSocket("ws://localhost:3001");
let viewerWindow;
socket.onmessage = function (event) {
  if (event.data === "open_viewer") {
    viewerWindow = window.open("/viewer", "Viewer", "width=800,height=600");
  }
  if (event.data === "close" && viewerWindow) {
    viewerWindow.close();
  }
};
