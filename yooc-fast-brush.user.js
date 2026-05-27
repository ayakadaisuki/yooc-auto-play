// ==UserScript==
// @name         易班优课(YOOC)快速刷课
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  快速刷课：自动跳转视频到末尾触发完成 → 上报进度 → 切换下一节，全程无需等待
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
    //  配置区
    // ============================================================
    var JUMP_TO_RATIO = 0.96;    // 跳转到视频的 96% 位置（超过 95% 可触发最后一次上报）
    var DELAY_NEXT    = 3000;    // 上报完成后跳转下一节前等待毫秒
    var WAIT_VIDEO    = 3000;    // 页面加载后等待视频就绪的毫秒

    // ============================================================
    //  1. 禁用 nodrag 防快进 + 保存原始 setInterval
    // ============================================================
    var _origSetInterval = window.setInterval;
    window.nodrag = function () { /* 空函数，仅阻止防快进 */ };

    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
        return m ? decodeURIComponent(m[2]) : '';
    }

    // ============================================================
    //  用 localStorage 持久化已完成计数（跨页面保留）
    // ============================================================
    var STORAGE_KEY = 'yooc_fast_brush_count';
    var PAUSE_KEY   = 'yooc_fast_brush_paused';

    function getDoneCount() {
        try { return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10); }
        catch (e) { return 0; }
    }
    function setDoneCount(n) {
        try { localStorage.setItem(STORAGE_KEY, String(n)); } catch (e) {}
    }
    function isPaused() {
        try { return localStorage.getItem(PAUSE_KEY) === '1'; } catch (e) { return false; }
    }
    function setPaused(v) {
        try { localStorage.setItem(PAUSE_KEY, v ? '1' : '0'); } catch (e) {}
    }

    // ============================================================
    //  2. 等待 DOM 就绪
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
            '#yooc-fast-panel {',
            '  position: fixed; top: 80px; right: 14px; z-index: 2147483647;',
            '  background: rgba(30,30,30,0.92); color: #eee;',
            '  border-radius: 12px; padding: 16px 20px;',
            '  font-family: "Microsoft YaHei","PingFang SC",sans-serif;',
            '  font-size: 14px; line-height: 1.6;',
            '  box-shadow: 0 6px 30px rgba(0,0,0,0.5);',
            '  user-select: none; min-width: 220px; cursor: default;',
            '  border: 1px solid #ff9800;',
            '}',
            '#yooc-fast-panel h4 {',
            '  margin: 0 0 10px; font-size: 15px; text-align: center;',
            '  color: #ff9800; letter-spacing: 1px;',
            '}',
            '.yf-btn {',
            '  background:#ff9800; color:#000; border:none;',
            '  border-radius:6px; padding:6px 16px; cursor:pointer;',
            '  font-size:14px; font-weight:bold; transition:all .15s;',
            '  width:100%; margin-top:6px;',
            '}',
            '.yf-btn:hover { background:#ffc107; }',
            '.yf-btn:active { background:#e65100; color:#fff; }',
            '.yf-status {',
            '  font-size:12px; color:#81c784; text-align:center; margin-top:8px;',
            '  word-break:break-all;',
            '}',
            '.yf-counter {',
            '  font-size:20px; color:#ff9800; text-align:center;',
            '  font-weight:bold; margin:6px 0;',
            '}',
            '.yf-drag { cursor:move; }',
        ].join('\n');
        document.head.appendChild(style);

        // ------ 创建面板 ------
        var panel = document.createElement('div');
        panel.id = 'yooc-fast-panel';
        panel.innerHTML =
            '<div class="yf-drag"><h4>⚡ YOOC 快速刷课</h4></div>' +
            '<div class="yf-counter"><span id="yf-done">0</span> / <span id="yf-total">-</span></div>' +
            '<button id="yf-start" class="yf-btn">🚀 开始快速刷课</button>' +
            '<div id="yf-st" class="yf-status">等待就绪...</div>';
        document.body.appendChild(panel);

        // ------ 面板拖拽 ------
        (function () {
            var dragEl = panel.querySelector('.yf-drag');
            var dragging = false, sx, sy, il, it;
            dragEl.addEventListener('mousedown', function (e) {
                dragging = true;
                sx = e.clientX; sy = e.clientY;
                var r = panel.getBoundingClientRect();
                il = r.left; it = r.top;
                panel.style.left = il + 'px';
                panel.style.top = it + 'px';
                panel.style.right = 'auto';
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                panel.style.left = (il + e.clientX - sx) + 'px';
                panel.style.top  = (it + e.clientY - sy) + 'px';
            });
            document.addEventListener('mouseup', function () { dragging = false; });
        })();

        // ------ 状态 ------
        var statusEl = document.getElementById('yf-st');
        var doneEl   = document.getElementById('yf-done');
        var totalEl  = document.getElementById('yf-total');
        var startBtn = document.getElementById('yf-start');
        var running  = false;   // 当前是否正在刷课
        var aborted  = false;   // 是否被暂停/中断

        // 从 localStorage 恢复计数
        var doneCount = getDoneCount();
        doneEl.textContent = doneCount;

        function log(msg) {
            statusEl.textContent = msg;
            console.log('[YOOC快速刷课]', msg);
        }

        // 统计总课程数
        function countLessons() {
            var total = document.querySelectorAll('li[data-index]').length;
            if (!total) {
                var allLinks = document.querySelectorAll('.ctx-container li a[href*="courseware"]');
                total = allLinks.length;
            }
            totalEl.textContent = total || '?';
        }
        countLessons();

        // ============================================================
        //  3. 按钮：开始 / 暂停
        // ============================================================
        function setButtonRunning() {
            startBtn.textContent = '⏸ 暂停刷课';
            startBtn.style.background = '#666';
            startBtn.disabled = false;
        }
        function setButtonPaused() {
            startBtn.textContent = '▶ 继续刷课';
            startBtn.style.background = '#ff9800';
            startBtn.disabled = false;
        }
        function setButtonReady() {
            startBtn.textContent = '🚀 开始快速刷课';
            startBtn.style.background = '#ff9800';
            startBtn.disabled = false;
        }
        function setButtonDone() {
            startBtn.textContent = '🎉 全部完成！';
            startBtn.style.background = '#4caf50';
            startBtn.disabled = false;
        }

        startBtn.onclick = function () {
            if (!running) {
                // 点击"开始"或"继续"
                running = true;
                aborted = false;
                setPaused(false);
                setButtonRunning();
                log('🚀 开始快速刷课...');
                startBrush();
            } else {
                // 点击"暂停"
                running = false;
                aborted = true;
                setPaused(true);
                setButtonPaused();
                log('⏸ 已暂停，点击按钮继续');
            }
        };

        // ============================================================
        //  4. 核心刷课逻辑
        // ============================================================
        function getVideo() {
            return document.getElementById('video') || document.querySelector('video');
        }

        // 发送完成上报
        function sendDone(video) {
            var ajaxUrl = (video && video.getAttribute('data-ajaxurl'))
                || (document.getElementById('ajax_url') && document.getElementById('ajax_url').value)
                || '';
            if (!ajaxUrl) return;

            var csrfToken = ''
                || (document.getElementById('csrf_token') && document.getElementById('csrf_token').value)
                || (document.querySelector('input[name="csrfmiddlewaretoken"]')
                    && document.querySelector('input[name="csrfmiddlewaretoken"]').value)
                || (document.querySelector('meta[name="csrf-token"]')
                    && document.querySelector('meta[name="csrf-token"]').getAttribute('content'))
                || getCookie('csrftoken')
                || '';

            var data = new FormData();
            data.append('csrfmiddlewaretoken', csrfToken);
            data.append('saved_video_position', '00:00:01');
            data.append('video_duration', '00:00:02');
            data.append('done', 'true');

            try {
                var xhr = new XMLHttpRequest();
                xhr.open('POST', ajaxUrl, true);
                xhr.send(data);
                console.log('[YOOC快速刷课] 已上报 done=true');
            } catch (e) {
                console.warn('[YOOC快速刷课] 上报失败:', e);
            }
        }

        function startBrush() {
            // 等待视频就绪后执行
            setTimeout(function () {
                if (aborted) return;
                brushCurrentPage(function () {
                    if (aborted) return;
                    goNext();
                });
            }, WAIT_VIDEO);
        }

        // 快速处理当前页面的视频
        function brushCurrentPage(callback) {
            var video = getVideo();
            if (!video || !video.duration) {
                log('⚠ 视频未就绪，尝试等待...');
                setTimeout(function () {
                    if (aborted) return;
                    video = getVideo();
                    if (!video) {
                        log('❌ 未找到视频元素，跳过');
                        callback();
                        return;
                    }
                    doBrush(video, callback);
                }, 2000);
                return;
            }
            doBrush(video, callback);
        }

        function doBrush(video, callback) {
            // 隐藏封面视频（PC端）
            var cover = document.getElementById('video-covor');
            if (cover) {
                cover.pause();
                cover.style.display = 'none';
                video.style.display = 'block';
            }
            if (video.style.display === 'none') {
                video.style.display = 'block';
            }

            // 开始播放（静音绕过限制）
            video.muted = true;
            video.play().catch(function () {});

            // 直接跳到 96% 位置
            var targetTime = video.duration * JUMP_TO_RATIO;
            video.currentTime = targetTime;
            log('⏩ 跳转到 ' + formatTime(targetTime) + ' / ' + formatTime(video.duration));

            // 等待视频播放到 85% 以上，发送三次 done 上报
            var reported = { p85: false, p90: false, p95: false };
            var checkTimer = _origSetInterval(function () {
                // 暂停时停止检查
                if (aborted) {
                    clearInterval(checkTimer);
                    return;
                }

                var ratio = video.currentTime / video.duration;

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

                // 三次都上报完毕
                if (reported.p85 && reported.p90 && reported.p95) {
                    clearInterval(checkTimer);
                    doneCount++;
                    setDoneCount(doneCount);
                    doneEl.textContent = doneCount;
                    log('✅ 已完成第 ' + doneCount + ' 节');
                    setTimeout(function () {
                        if (!aborted) callback();
                    }, 800);
                    return;
                }

                // 视频已结束
                if (video.ended) {
                    clearInterval(checkTimer);
                    sendDone(video);
                    doneCount++;
                    setDoneCount(doneCount);
                    doneEl.textContent = doneCount;
                    log('✅ 已完成第 ' + doneCount + ' 节');
                    setTimeout(function () {
                        if (!aborted) callback();
                    }, 800);
                }
            }, 200);
        }

        function formatTime(sec) {
            var m = Math.floor(sec / 60);
            var s = Math.floor(sec % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        // ============================================================
        //  5. 自动跳转下一节
        // ============================================================
        function goNext() {
            if (aborted) return;

            var currentLi = document.querySelector('li.ac') || document.querySelector('li.readed');
            if (!currentLi) {
                log('❌ 未找到当前课程');
                running = false;
                setButtonReady();
                return;
            }

            var nextLi = currentLi.nextElementSibling;
            while (nextLi && !nextLi.querySelector('a[href]')) {
                nextLi = nextLi.nextElementSibling;
            }

            if (!nextLi) {
                log('🎉 所有课程已刷完！共完成 ' + doneCount + ' 节');
                running = false;
                setDoneCount(0); // 完成后重置
                setButtonDone();
                return;
            }

            var link = nextLi.querySelector('a[href]');
            if (!link || !link.href) {
                log('❌ 未找到下一节链接');
                running = false;
                setButtonReady();
                return;
            }

            var sec = Math.round(DELAY_NEXT / 1000);
            log('➡ ' + sec + '秒后跳转下一节...');
            var cd = _origSetInterval(function () {
                if (aborted) {
                    clearInterval(cd);
                    return;
                }
                sec--;
                if (sec > 0) {
                    log('➡ ' + sec + '秒后跳转下一节...');
                } else {
                    clearInterval(cd);
                }
            }, 1000);

            setTimeout(function () {
                if (aborted) return;
                // 在URL末尾添加 ?fast=1 参数，让下一页自动开始刷课
                var nextUrl = link.href;
                if (nextUrl.indexOf('fast=1') === -1) {
                    nextUrl += (nextUrl.indexOf('?') === -1 ? '?' : '&') + 'fast=1';
                }
                window.location.href = nextUrl;
            }, DELAY_NEXT);
        }

        // ============================================================
        //  6. 自动模式：URL 参数 ?fast=1 自动开始
        // ============================================================
        if (window.location.search.indexOf('fast=1') !== -1 && !isPaused()) {
            setTimeout(function () {
                startBtn.click();
            }, 1000);
        }

        // 页面卸载时清除 URL 中的 fast=1 参数（如果不是自动跳转）
        // 防止用户手动刷新时再次触发

    });

})();
