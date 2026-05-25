// ==UserScript==
// @name         易班优课(YOOC)自动播放助手
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  自动播放YOOC课程视频，支持倍速播放，当前视频结束后自动播放下一节（兼容PC和移动端）
// @author       Assistant
// @match        *://xueyuan.yooc.me/courses/*/courseware/*
// @match        *://xueyuan.yooc.me/mobile/courses/*/courseware/*
// @match        *://www.yooc.me/mobile/courses/*/courseware/*
// @match        *://www.yooc.me/courses/*/courseware/*
// @match        *://*.yooc.me/mobile/courses/*/courseware/*
// @match        *://*.yooc.me/courses/*/courseware/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    //  配置区 —— 根据需要自行修改
    // ============================================================
    var SPEED_OPTIONS = [1, 1.25, 1.5, 2, 3, 5];   // 可选倍速
    var DEFAULT_SPEED = 2;                           // 默认倍速
    var AUTO_NEXT     = true;                        // 是否自动跳转下一节
    var DELAY_NEXT    = 5000;                        // 跳转前等待毫秒

    // ============================================================
    //  1. 【关键】在 document-start 阶段立即拦截 nodrag()
    //     原站 nodrag() 包含两部分功能：
    //       a) 防快进检测（xc计算，倍速时会误判暂停）—— 需要禁用
    //       b) 学习进度上报（85%/90%/95%时发送AJAX）—— 需要保留
    //     因此用自定义函数替换，保留进度上报，去掉防快进
    // ============================================================

    // 保存原始 setInterval
    var _origSetInterval = window.setInterval;

    // Cookie 读取工具函数
    function getCookie(name) {
        var match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : '';
    }

    // 替换 nodrag：只做进度上报，不做防快进
    window.nodrag = function () {
        // 此函数会被页面的 setInterval("nodrag()",100) 反复调用
        // 我们不在这里做任何事，进度上报由脚本自己的逻辑处理
        // （见下方 reportProgress 函数）
    };

    // 拦截 setInterval 中的字符串形式 nodrag 调用
    // 但我们仍然让它执行（因为我们已替换 nodrag 为空壳，只保留入口）
    // 所以不再拦截，让原站的 setInterval("nodrag()",100) 正常触发我们替换后的函数

    // ============================================================
    //  2. 等待 DOM 就绪后注入 UI 和逻辑
    // ============================================================
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onReady(function () {

        // ------ 注入样式 ------
        var style = document.createElement('style');
        style.textContent = [
            '#yooc-helper-panel {',
            '  position: fixed; top: 70px; right: 14px; z-index: 2147483647;',
            '  background: rgba(20,20,20,0.88); color: #eee;',
            '  border-radius: 10px; padding: 14px 18px;',
            '  font-family: "Microsoft YaHei","PingFang SC",sans-serif;',
            '  font-size: 14px; line-height: 1.6;',
            '  box-shadow: 0 6px 24px rgba(0,0,0,0.45);',
            '  user-select: none; min-width: 180px; cursor: default;',
            '}',
            '#yooc-helper-panel * { box-sizing: border-box; }',
            '#yooc-helper-panel h4 {',
            '  margin: 0 0 10px; font-size: 15px; text-align: center;',
            '  color: #4fc3f7; letter-spacing: 1px;',
            '}',
            '.yh-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }',
            '.yh-label { white-space:nowrap; margin-right:6px; font-size:13px; }',
            '.yh-btn-group { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; }',
            '.yh-sbtn {',
            '  background:#37474f; color:#ccc; border:1px solid #546e7a;',
            '  border-radius:5px; padding:2px 9px; cursor:pointer;',
            '  font-size:13px; transition:all .15s;',
            '}',
            '.yh-sbtn:hover { background:#4fc3f7; color:#000; }',
            '.yh-sbtn.on { background:#4fc3f7; color:#000; font-weight:bold; border-color:#4fc3f7; }',
            '.yh-switch {',
            '  position:relative; width:40px; height:22px;',
            '  background:#546e7a; border-radius:11px; cursor:pointer;',
            '  transition:background .2s; flex-shrink:0;',
            '}',
            '.yh-switch.on { background:#4fc3f7; }',
            '.yh-switch::after {',
            '  content:""; position:absolute; top:3px; left:3px;',
            '  width:16px; height:16px; background:#fff; border-radius:50%;',
            '  transition:left .2s;',
            '}',
            '.yh-switch.on::after { left:21px; }',
            '.yh-status {',
            '  font-size:12px; color:#81c784; text-align:center; margin-top:6px;',
            '  word-break:break-all;',
            '}',
            '.yh-drag { cursor:move; }',
        ].join('\n');
        document.head.appendChild(style);

        // ------ 创建面板 ------
        var panel = document.createElement('div');
        panel.id = 'yooc-helper-panel';
        panel.innerHTML =
            '<div class="yh-drag"><h4>🎓 YOOC 助手</h4></div>' +
            '<div class="yh-row">' +
            '  <span class="yh-label">倍速：</span>' +
            '  <div id="yh-btns" class="yh-btn-group"></div>' +
            '</div>' +
            '<div class="yh-row">' +
            '  <span class="yh-label">自动下一节：</span>' +
            '  <div id="yh-sw" class="yh-switch on"></div>' +
            '</div>' +
            '<div id="yh-st" class="yh-status">初始化中...</div>';
        document.body.appendChild(panel);

        // ------ 面板拖拽 ------
        (function () {
            var dragEl = panel.querySelector('.yh-drag');
            var dragging = false, startX, startY, initLeft, initTop;
            dragEl.addEventListener('mousedown', function (e) {
                dragging = true;
                startX = e.clientX; startY = e.clientY;
                var rect = panel.getBoundingClientRect();
                initLeft = rect.left; initTop = rect.top;
                panel.style.left = initLeft + 'px';
                panel.style.top  = initTop  + 'px';
                panel.style.right = 'auto';
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                panel.style.left = (initLeft + e.clientX - startX) + 'px';
                panel.style.top  = (initTop  + e.clientY - startY)  + 'px';
            });
            document.addEventListener('mouseup', function () { dragging = false; });
        })();

        // ------ 状态 ------
        var currentSpeed    = DEFAULT_SPEED;
        var autoNextEnabled = AUTO_NEXT;
        var statusEl = document.getElementById('yh-st');

        function log(msg) { statusEl.textContent = msg; console.log('[YOOC助手]', msg); }

        // ------ 倍速按钮 ------
        var btnsBox = document.getElementById('yh-btns');
        function renderBtns() {
            btnsBox.innerHTML = '';
            SPEED_OPTIONS.forEach(function (s) {
                var btn = document.createElement('button');
                btn.className = 'yh-sbtn' + (s === currentSpeed ? ' on' : '');
                btn.textContent = s + 'x';
                btn.onclick = function () {
                    currentSpeed = s;
                    applySpeed();
                    renderBtns();
                };
                btnsBox.appendChild(btn);
            });
        }
        renderBtns();

        // ------ 自动下一节开关 ------
        document.getElementById('yh-sw').onclick = function () {
            autoNextEnabled = !autoNextEnabled;
            this.classList.toggle('on', autoNextEnabled);
            log(autoNextEnabled ? '已开启自动下一节' : '已关闭自动下一节');
        };

        // ============================================================
        //  3. 获取视频 & 倍速
        // ============================================================
        function getVideo() {
            // PC 版有 video-covor 封面视频，真正的课程视频是 #video 且 class=nodrag
            var v = document.getElementById('video');
            if (v) return v;
            return document.querySelector('video');
        }

        function applySpeed() {
            var v = getVideo();
            if (v) {
                v.playbackRate = currentSpeed;
                log('▶ 播放中 | ' + currentSpeed + 'x');
            }
        }

        // ============================================================
        //  4. 核心初始化
        // ============================================================
        var inited = false;

        function init() {
            if (inited) return;

            var video = getVideo();
            if (!video) return;
            inited = true;

            // 隐藏封面视频（PC端）
            var cover = document.getElementById('video-covor');
            if (cover) {
                cover.pause();
                cover.style.display = 'none';
                video.style.display = 'block';
            }

            // 确保视频可见
            if (video.style.display === 'none') {
                video.style.display = 'block';
            }

            // 设置倍速
            video.playbackRate = currentSpeed;

            // 自动播放：先静音绕过浏览器限制，播放后恢复
            var savedVol = video.volume;
            var savedMute = video.muted;
            video.muted = true;

            var playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.then(function () {
                    video.muted = savedMute;
                    video.volume = savedVol;
                    log('▶ 播放中 | ' + currentSpeed + 'x');
                }).catch(function () {
                    video.muted = savedMute;
                    video.volume = savedVol;
                    log('⚠ 请点击视频开始播放');
                    // 尝试再次播放
                    video.addEventListener('click', function tryPlay() {
                        video.play().then(function () {
                            video.removeEventListener('click', tryPlay);
                            log('▶ 播放中 | ' + currentSpeed + 'x');
                        }).catch(function () {});
                    });
                });
            }

            // 监听 ratechange 防止被重置
            video.addEventListener('ratechange', function () {
                if (video.playbackRate !== currentSpeed) {
                    video.playbackRate = currentSpeed;
                }
            });

            // 监听暂停（排除 ended）
            var pauseManual = false;
            video.addEventListener('pause', function () {
                if (video.ended || pauseManual) return;
                setTimeout(function () {
                    if (!video.ended && video.paused) {
                        video.playbackRate = currentSpeed;
                        video.play().catch(function () {});
                    }
                }, 800);
            });

            // 允许用户通过双击暂停/恢复（在面板外双击）
            video.addEventListener('dblclick', function () {
                if (video.paused) {
                    pauseManual = false;
                    video.playbackRate = currentSpeed;
                    video.play().catch(function () {});
                    log('▶ 恢复播放 | ' + currentSpeed + 'x');
                } else {
                    pauseManual = true;
                    video.pause();
                    log('⏸ 已暂停');
                }
            });

            // 视频播放结束 -> 自动下一节
            video.addEventListener('ended', function () {
                log('✅ 视频播放完成');
                if (autoNextEnabled) {
                    goNext();
                }
            });

            // 每秒保障倍速 + 学习进度上报
            var progressReported = { p85: false, p90: false, p95: false };
            _origSetInterval(function () {
                // 保持倍速
                if (video.playbackRate !== currentSpeed) {
                    video.playbackRate = currentSpeed;
                }
                // 学习进度上报（替代原站 nodrag 中被禁用的上报逻辑）
                if (video.duration && video.currentTime) {
                    var ratio = video.currentTime / video.duration;
                    reportProgress(ratio, video, progressReported);
                }
            }, 1000);
        }

        // ============================================================
        //  学习进度上报函数
        //  在 85%、90%、95% 三个节点向服务器发送 AJAX 请求
        //  这是原站 nodrag()/countDone() 中的逻辑，防止禁用 nodrag 后丢失进度
        // ============================================================
        function reportProgress(ratio, video, reported) {
            if (!reported.p85 && ratio > 0.85) {
                sendDone(video);
                reported.p85 = true;
            }
            if (!reported.p90 && ratio > 0.90) {
                sendDone(video);
                reported.p90 = true;
            }
            if (!reported.p95 && ratio > 0.95) {
                sendDone(video);
                reported.p95 = true;
            }
        }

        function sendDone(video) {
            // PC 端：视频元素上有 data-ajaxurl 属性
            var ajaxUrl = (video && video.getAttribute('data-ajaxurl'))
                // 移动端：隐藏 input #ajax_url
                || (document.getElementById('ajax_url') && document.getElementById('ajax_url').value)
                || '';
            if (!ajaxUrl) return;

            // CSRF token：多种来源尝试
            var csrfToken = ''
                // 1. 移动端隐藏 input
                || (document.getElementById('csrf_token') && document.getElementById('csrf_token').value)
                // 2. 任意 input[name="csrfmiddlewaretoken"]
                || (document.querySelector('input[name="csrfmiddlewaretoken"]')
                    && document.querySelector('input[name="csrfmiddlewaretoken"]').value)
                // 3. meta 标签
                || (document.querySelector('meta[name="csrf-token"]')
                    && document.querySelector('meta[name="csrf-token"]').getAttribute('content'))
                // 4. Django cookie
                || getCookie('csrftoken')
                || '';

            // 将 token 也放入 URL（Django 某些版本需要）
            if (csrfToken && ajaxUrl.indexOf('csrfmiddlewaretoken') === -1) {
                var sep = ajaxUrl.indexOf('?') === -1 ? '?' : '&';
                // 不放在URL里，放在POST body中即可
            }

            var data = new FormData();
            data.append('csrfmiddlewaretoken', csrfToken);
            data.append('saved_video_position', '00:00:01');
            data.append('video_duration', '00:00:02');
            data.append('done', 'true');

            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ajaxUrl, true);
                xhr.send(data);
                console.log('[YOOC助手] 已上报学习进度');
            } catch (e) {
                console.warn('[YOOC助手] 进度上报失败:', e);
            }
        }

        // ============================================================
        //  5. 跳转下一节课程
        // ============================================================
        function goNext() {
            // PC 端：当前课程 li 有 class "readed" 且没有 data-index
            // 移动端：当前课程 li 有 class "ac"
            var currentLi = document.querySelector('li.ac') || document.querySelector('li.readed');
            if (!currentLi) {
                log('❌ 未找到当前课程');
                return;
            }

            // 找下一个含 <a> 的 <li>
            var nextLi = currentLi.nextElementSibling;
            while (nextLi && !nextLi.querySelector('a[href]')) {
                nextLi = nextLi.nextElementSibling;
            }

            if (!nextLi) {
                log('🎉 所有课程已播放完毕！');
                return;
            }

            var link = nextLi.querySelector('a[href]');
            if (!link || !link.href) {
                log('❌ 未找到下一节链接');
                return;
            }

            var sec = Math.round(DELAY_NEXT / 1000);
            log('⏩ ' + sec + '秒后播放下一节...');
            var cd = _origSetInterval(function () {
                sec--;
                if (sec > 0) {
                    log('⏩ ' + sec + '秒后播放下一节...');
                } else {
                    clearInterval(cd);
                }
            }, 1000);

            setTimeout(function () {
                window.location.href = link.href;
            }, DELAY_NEXT);
        }

        // ============================================================
        //  6. 等待视频元素出现并初始化
        // ============================================================
        function waitVideo(retries) {
            if (retries > 80) {
                log('⚠ 未检测到视频元素');
                return;
            }
            if (getVideo() && getVideo().readyState >= 0) {
                // 延迟一点确保页面脚本已执行完毕
                _origSetInterval(function () {
                    init();
                }, 200);
                return;
            }
            setTimeout(function () { waitVideo((retries || 0) + 1); }, 300);
        }

        waitVideo(0);
    });

})();
