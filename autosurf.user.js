// ==UserScript==
// @name         AutoSurf
// @name:zh-CN   AutoSurf
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Uses AI to break down a multi-step goal, highlights each actionable element, and executes it step-by-step upon user confirmation. Includes content upload options. Now with improved input for modern JS frameworks.
// @description:zh-CN  使用AI将你的多步骤目标分解开来，高亮每步的可操作元素，并在你逐一确认后执行。包含内容上传选项。已优化对现代JS框架的输入支持。
// @author       StreetArtist
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_notification
// @connect      api.deepseek.com
// @connect      open.bigmodel.cn
// @license      GPL-3.0
// ==/UserScript==

(function() {
    'use strict';

    let isExecuting = false;
    let currentStepElement = null;
    let executionPlan = [];

    // --- 配置项 ---
    const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
    const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
    const HIGHLIGHT_CLASS = 'deepseek-highlight-element';
    const MAX_RETRY_ATTEMPTS = 3;
    const RETRY_DELAY = 1000;

    // --- 样式注入 ---
    GM_addStyle(`
        #deepseek-automator-panel {
            position: fixed;
            top: 100px;
            right: 20px;
            width: 350px;
            background-color: #f0f8ff;
            border: 1px solid #b0c4de;
            border-radius: 8px;
            z-index: 99999;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            transition: transform 0.3s ease-in-out;
            display: flex;
            flex-direction: column;
        }
        #deepseek-automator-panel.hidden {
            transform: translateX(calc(100% + 30px));
        }
        #ds-drag-handle {
            padding: 10px;
            cursor: move;
            background-color: #d6eaf8;
            border-top-left-radius: 8px;
            border-top-right-radius: 8px;
            border-bottom: 1px solid #b0c4de;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        #ds-drag-handle h3 {
            margin: 0;
            font-size: 16px;
            color: #2c3e50;
        }
        #ds-toggle-button, #ds-stop-btn, #ds-settings-btn {
            cursor: pointer;
            font-weight: bold;
            padding: 2px 8px;
            border: 1px solid #2c3e50;
            border-radius: 4px;
            margin-left: 5px;
            background: #ecf0f1;
            font-size: 14px;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        #ds-stop-btn {
            display: none;
            background: #e74c3c;
            color: white;
            border-color: #c0392b;
        }
        .ds-content {
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .ds-content label {
            font-weight: bold;
            font-size: 14px;
            color: #34495e;
        }
        .ds-content input, .ds-content textarea, .ds-content select {
            width: 100%;
            padding: 8px;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-sizing: border-box;
            font-size: 14px;
        }
        .ds-content textarea {
            resize: vertical;
            min-height: 80px;
        }
        #ds-analyze-btn, #ds-cancel-btn {
            padding: 10px 15px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 15px;
            transition: background-color 0.2s;
            flex: 1;
            text-align: center;
        }
        #ds-analyze-btn {
            background-color: #3498db;
            color: white;
        }
        #ds-analyze-btn:hover:not(:disabled) {
            background-color: #2980b9;
        }
        #ds-analyze-btn:disabled {
            background-color: #bdc3c7;
            cursor: not-allowed;
        }
        #ds-cancel-btn {
            background-color: #e67e22;
            color: white;
        }
        #ds-cancel-btn:hover {
            background-color: #d35400;
        }
        .${HIGHLIGHT_CLASS} {
            outline: 3px solid #e74c3c !important;
            box-shadow: 0 0 15px #e74c3c !important;
            background-color: rgba(231, 76, 60, 0.2) !important;
            transition: all 0.3s;
            z-index: 99998 !important;
        }
        .ds-progress-bar {
            width: 100%;
            height: 5px;
            background-color: #e0e0e0;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 5px;
        }
        .ds-progress-fill {
            height: 100%;
            background-color: #3498db;
            width: 0%;
            transition: width 0.3s ease;
        }
        .ds-step-info {
            margin-top: 10px;
            padding: 8px;
            background-color: #f8f9fa;
            border-radius: 4px;
            font-size: 13px;
            max-height: 100px;
            overflow-y: auto;
        }
        .ds-step-info h4 {
            margin: 0 0 5px 0;
            color: #2c3e50;
        }
        .ds-step-info p {
            margin: 3px 0;
            color: #555;
        }
        .ds-log {
            margin-top: 10px;
            padding: 8px;
            background-color: #f8f9fa;
            border-radius: 4px;
            font-size: 12px;
            max-height: 100px;
            overflow-y: auto;
            font-family: monospace;
        }
        @media (max-width: 600px) {
            #deepseek-automator-panel { width: 90%; left: 5%; right: 5%; top: 10px; }
            #deepseek-automator-panel.hidden { transform: translateY(-calc(100% + 20px)); }
        }
    `);

    // --- UI 创建 ---
    const panel = document.createElement('div');
    panel.id = 'deepseek-automator-panel';
    panel.innerHTML = `
        <div id="ds-drag-handle">
            <h3>AI多步助手</h3>
            <div>
                <span id="ds-settings-btn" title="设置">⚙</span>
                <span id="ds-stop-btn" title="停止执行">■</span>
                <span id="ds-toggle-button" title="收起/展开面板">_</span>
            </div>
        </div>
        <div class="ds-content">
            <label for="ds-ai-provider">选择AI提供商:</label>
            <select id="ds-ai-provider">
                <option value="deepseek">DeepSeek</option>
                <option value="zhipu">智谱AI (GLM-4.6)</option>
            </select>

            <label for="ds-api-key">API Key:</label>
            <div style="display: flex; gap: 5px;">
                <input type="password" id="ds-api-key" placeholder="在此输入你的API Key">
                <button id="ds-save-key-btn" style="flex-shrink:0;">保存</button>
            </div>

            <label for="ds-user-goal">描述你的多步骤任务:</label>
            <textarea id="ds-user-goal" placeholder="例如：1. 点击搜索框; 2. 输入'JavaScript教程'; 3. 按回车键搜索;"></textarea>

            <label for="ds-content-upload">网页内容上传选项:</label>
            <select id="ds-content-upload">
                <option value="no_content">不提交网页内容</option>
                <option value="no_css">去掉CSS提交</option>
                <option value="no_js">去掉JavaScript</option>
                <option value="no_js_css">去掉JavaScript和CSS</option>
                <option value="full_html">原始上传</option>
            </select>

            <label for="ds-delay">执行延迟 (毫秒):</label>
            <select id="ds-delay">
                <option value="500">500ms</option>
                <option value="1000" selected>1000ms</option>
                <option value="1500">1500ms</option>
                <option value="2000">2000ms</option>
                <option value="3000">3000ms</option>
            </select>

            <div style="display: flex; gap: 10px;">
                <button id="ds-analyze-btn">开始执行</button>
            </div>

            <div class="ds-progress-bar">
                <div class="ds-progress-fill" id="ds-progress-fill"></div>
            </div>

            <div class="ds-step-info" id="ds-step-info" style="display: none;">
                <h4>当前步骤信息</h4>
                <p id="ds-step-details"></p>
            </div>

            <div class="ds-log" id="ds-log">
                <p>等待开始执行...</p>
            </div>
        </div>
    `;
    document.body.appendChild(panel);

    // --- 获取元素 ---
    const aiProviderSelect = document.getElementById('ds-ai-provider');
    const apiKeyInput = document.getElementById('ds-api-key');
    const saveKeyBtn = document.getElementById('ds-save-key-btn');
    const userGoalInput = document.getElementById('ds-user-goal');
    const contentUploadSelect = document.getElementById('ds-content-upload');
    const analyzeBtn = document.getElementById('ds-analyze-btn');
    const dragHandle = document.getElementById('ds-drag-handle');
    const contentDiv = panel.querySelector('.ds-content');
    const toggleBtn = document.getElementById('ds-toggle-button');
    const stopBtn = document.getElementById('ds-stop-btn');
    const settingsBtn = document.getElementById('ds-settings-btn');
    const progressFill = document.getElementById('ds-progress-fill');
    const stepInfo = document.getElementById('ds-step-info');
    const stepDetails = document.getElementById('ds-step-details');
    const logDiv = document.getElementById('ds-log');
    const delaySelect = document.getElementById('ds-delay');

    // --- 功能实现 ---

    // 根据AI提供商更新API Key输入框
    function updateApiKeyInput() {
        const provider = aiProviderSelect.value;
        if (provider === 'deepseek') {
            apiKeyInput.value = GM_getValue('deepseek_api_key', '');
        } else if (provider === 'zhipu') {
            apiKeyInput.value = GM_getValue('zhipu_api_key', '');
        }
    }

    // 监听AI提供商变化，自动切换API Key
    aiProviderSelect.addEventListener('change', () => {
        updateApiKeyInput();
        GM_setValue('ai_provider', aiProviderSelect.value);
        logMessage(`已切换到 ${aiProviderSelect.value === 'deepseek' ? 'DeepSeek' : '智谱AI'}`);
    });

    aiProviderSelect.value = GM_getValue('ai_provider', 'deepseek');
    // 根据当前选择的AI提供商加载对应的API Key
    updateApiKeyInput();
    contentUploadSelect.value = GM_getValue('content_upload_option', 'no_content');
    delaySelect.value = GM_getValue('execution_delay', '1000');

    // 添加日志记录功能
    function logMessage(message) {
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('p');
        logEntry.textContent = `[${timestamp}] ${message}`;
        logDiv.appendChild(logEntry);

        // 保持滚动到底部
        logDiv.scrollTop = logDiv.scrollHeight;

        // 限制日志条目数量
        if (logDiv.children.length > 20) {
            logDiv.removeChild(logDiv.firstChild);
        }
    }

    saveKeyBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        const provider = aiProviderSelect.value;
        if (key) {
            if (provider === 'deepseek') {
                GM_setValue('deepseek_api_key', key);
                logMessage('DeepSeek API Key 已保存！');
            } else if (provider === 'zhipu') {
                GM_setValue('zhipu_api_key', key);
                logMessage('智谱AI API Key 已保存！');
            }
        } else {
            logMessage('API Key 不能为空！');
        }
    });

    let isDragging = false, offsetX, offsetY;
    dragHandle.addEventListener('mousedown', (e) => {
        isDragging = true;
        offsetX = e.clientX - panel.offsetLeft;
        offsetY = e.clientY - panel.offsetTop;
        panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            panel.style.left = `${e.clientX - offsetX}px`;
            panel.style.top = `${e.clientY - offsetY}px`;
        }
    });
    document.addEventListener('mouseup', () => {
        isDragging = false;
        panel.style.transition = 'transform 0.3s ease-in-out';
    });

    toggleBtn.addEventListener('click', () => {
        contentDiv.style.display = contentDiv.style.display === 'none' ? 'flex' : 'flex';
        toggleBtn.textContent = contentDiv.style.display === 'none' ? '+' : '_';
    });

    // 设置按钮逻辑
    settingsBtn.addEventListener('click', () => {
        const currentDelay = delaySelect.value;
        const newDelay = prompt('设置执行延迟 (毫秒):', currentDelay);
        if (newDelay !== null) {
            const delayValue = parseInt(newDelay);
            if (!isNaN(delayValue) && delayValue >= 0) {
                delaySelect.value = delayValue;
                GM_setValue('execution_delay', delayValue.toString());
                logMessage(`执行延迟已设置为 ${delayValue}ms`);
            } else {
                alert('请输入有效的数字！');
            }
        }
    });

    // 停止按钮逻辑
    stopBtn.addEventListener('click', () => {
        if(isExecuting) {
            isExecuting = false; // 设置标志，让执行循环中断
            stopBtn.style.display = 'none';
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = '开始执行';
            if (currentStepElement) {
                currentStepElement.classList.remove(HIGHLIGHT_CLASS);
                currentStepElement = null;
            }
            logMessage('任务已停止。');
            GM_notification({
                text: '任务已停止',
                title: 'AI Automator',
                timeout: 3000
            });
        }
    });

    // 主执行按钮
    analyzeBtn.addEventListener('click', async () => {
        if (isExecuting) return; // 防止重复点击

        const aiProvider = aiProviderSelect.value;
        let apiKey = '';
        if (aiProvider === 'deepseek') {
            apiKey = GM_getValue('deepseek_api_key', '');
        } else if (aiProvider === 'zhipu') {
            apiKey = GM_getValue('zhipu_api_key', '');
        }

        const userGoal = userGoalInput.value.trim();
        const contentUploadOption = contentUploadSelect.value;
        const delay = parseInt(delaySelect.value) || 1000;

        if (!apiKey) {
            logMessage(`请先输入并保存您的 ${aiProvider === 'deepseek' ? 'DeepSeek' : '智谱AI'} API Key！`);
            return;
        }
        if (!userGoal) {
            logMessage('请描述您的多步骤任务！');
            return;
        }

        isExecuting = true;
        stopBtn.style.display = 'inline-block';
        setButtonState(true, '分析中...');
        logMessage(`使用 ${aiProvider === 'deepseek' ? 'DeepSeek' : '智谱AI'} 开始分析任务...`);
        clearStepInfo();

        try {
            let pageContent = '';
            if (contentUploadOption !== 'no_content') {
                pageContent = getPageContent(contentUploadOption);
                logMessage(`页面内容已提取，长度: ${pageContent.length} 字符`);
            } else {
                logMessage('页面内容上传选项为"不提交网页内容"，跳过内容提取');
            }

            const interactiveElements = extractInteractiveElements();
            if (interactiveElements.length === 0) throw new Error("在页面上没有找到可交互的元素。");

            logMessage(`找到 ${interactiveElements.length} 个可交互元素`);

            const prompt = buildPrompt(interactiveElements, userGoal, pageContent, contentUploadOption);
            const response = await callAIProviderAPI(prompt, aiProvider, apiKey);
            const plan = parseResponse(response);

            if (!plan || !Array.isArray(plan) || plan.length === 0) {
                throw new Error("AI未能提供有效的执行步骤。请检查AI的响应或调整您的任务描述。");
            }

            logMessage(`AI生成了 ${plan.length} 个执行步骤`);
            executionPlan = plan;

            // 逐步执行计划
            await executeStepByStep(plan, delay);

        } catch (error) {
            console.error('AI Automator Error:', error);
            logMessage(`发生错误: ${error.message}`);
            GM_notification({
                text: `执行失败: ${error.message}`,
                title: 'AI Automator',
                timeout: 5000
            });
        } finally {
            isExecuting = false;
            stopBtn.style.display = 'none';
            setButtonState(false, '开始执行');
            if(currentStepElement) currentStepElement.classList.remove(HIGHLIGHT_CLASS);
            clearStepInfo();
        }
    });

    // --- 辅助函数 ---

    function setButtonState(disabled, text) {
        analyzeBtn.disabled = disabled;
        analyzeBtn.innerHTML = text;
    }

    function clearStepInfo() {
        stepInfo.style.display = 'none';
        stepDetails.textContent = '';
    }

    function showStepInfo(step, element, action, text) {
        stepInfo.style.display = 'block';
        stepDetails.innerHTML = `
            <strong>步骤 ${step.step}/${executionPlan.length}</strong><br>
            <strong>操作:</strong> ${action}<br>
            <strong>元素:</strong> &lt;${element.tagName.toLowerCase()}&gt;<br>
            <strong>文本:</strong> "${(element.innerText || element.textContent || element.placeholder || '').substring(0, 60)}..."<br>
            ${text ? `<strong>输入内容:</strong> "${text}"` : ''}
        `;
    }

    function updateProgress(currentStep, totalSteps) {
        const progressPercent = (currentStep / totalSteps) * 100;
        progressFill.style.width = `${progressPercent}%`;
    }

    function extractInteractiveElements() {
        const elements = [];
        // 添加 label 以支持自定义表单控件
        const allSelectors = 'a, button, input, textarea, select, label, [role="button"], [role="link"], [onclick], [tabindex]:not([tabindex="-1"])';
        let counter = 0;

        // 辅助函数：获取元素的上下文（支持多级上下文提取）
        function getElementContext(element) {
            let contextParts = [];

            // 1. 关联 Label/文本 (针对 Input 或 自定义控件)
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
                let label = null;
                if (element.id) label = document.querySelector(`label[for="${element.id}"]`);
                if (!label) label = element.closest('label');
                if (label) contextParts.push((label.innerText || label.textContent || '').trim());
            } else if (element.tagName === 'LABEL' && element.getAttribute('for')) {
                const input = document.getElementById(element.getAttribute('for'));
                if (input && input.value) contextParts.push(`Value: ${input.value}`);
            } else {
                // 针对自定义控件 (如 a.jqradio)，查找兄弟节点的文本
                const parent = element.parentElement;
                if (parent) {
                    // 查找同级的 label 或 .label 元素
                    const siblingLabel = parent.querySelector('label, .label') || parent.parentElement.querySelector('label, .label');
                    if (siblingLabel && siblingLabel !== element) {
                        contextParts.push((siblingLabel.innerText || siblingLabel.textContent || '').trim());
                    }
                }
            }

            // 2. Level 1: 查找最近的子问题容器 (如矩阵题的一行)
            const subContainer = element.closest('.question-item, .form-group, .field, tr, li, [role="group"], [role="radiogroup"], .ui-controlgroup');
            if (subContainer) {
                // 查找子标题 (排除自身)
                const subTitle = subContainer.querySelector('.question-subtitle, .label, th, label, strong, b, .field-label');
                if (subTitle && subTitle !== element && !subTitle.contains(element)) {
                    // 避免重复添加已经找到的兄弟 label
                    const text = (subTitle.innerText || subTitle.textContent || '').trim();
                    if (!contextParts.includes(text)) {
                        contextParts.push(text);
                    }
                }
            }

            // 3. Level 2: 查找父级大问题容器 (如整个矩阵题区域)
            // 确保不与 subContainer 重复
            const mainContainer = element.closest('.question, .section, fieldset, .survey-page, .matrix-rating, .table-container');
            if (mainContainer && mainContainer !== subContainer) {
                // 查找大标题
                const mainTitle = mainContainer.querySelector('.question-title, .section-title, h1, h2, h3, h4, legend');
                if (mainTitle) {
                    contextParts.push((mainTitle.innerText || mainTitle.textContent || '').trim());
                }
                // 查找描述/说明文本 (通常包含评分标准，如 1-非常不满意)
                const descEl = mainContainer.querySelector('.question-desc, .description, .help-block, .question-tips');
                if (descEl) {
                    contextParts.push((descEl.innerText || descEl.textContent || '').trim());
                }
            }

            // 去重、过滤空值并连接
            return [...new Set(contextParts)]
                .filter(str => str && str.length > 0)
                .join(' | ')
                .substring(0, 400); // 增加长度限制以容纳更多上下文
        }

        document.querySelectorAll(allSelectors).forEach(el => {
            // 1. 基础可见性检查
            if (el.offsetParent === null) return;
            if (el.closest('script') || el.closest('style')) return;
            if (el.tagName === 'BODY' || el.tagName === 'HTML') return; // 排除顶级容器

            // 2. 排除隐藏的 input
            if (el.tagName === 'INPUT' && el.type === 'hidden') return;

            // 3. 文本内容检查
            // 获取有效文本
            const text = (el.innerText || el.textContent || el.value || el.ariaLabel || el.title || '').trim();
            const isFormElement = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
            
            // 如果不是表单输入元素，且没有文本，通常是无意义的布局元素或空容器
            // 例外：如果包含图标（svg/img），或者看起来像自定义表单控件（特定类名），则保留
            if (!isFormElement && !text) {
                const hasIcon = el.querySelector('svg, img, i[class*="icon"], span[class*="icon"]');
                // 检查是否是自定义表单控件 (如 jqradio, jqcheck, checkbox, radio)
                const isCustomControl = /radio|check|btn|button/i.test(el.className || '') || 
                                      /radio|check|btn|button/i.test(el.id || '');
                
                if (!hasIcon && !isCustomControl) return; 
            }

            // 4. 针对 Label 的特殊过滤
            if (el.tagName === 'LABEL') {
                const hasFor = el.hasAttribute('for');
                const hasInput = el.querySelector('input, select, textarea');
                const style = window.getComputedStyle(el);
                const isPointer = style.cursor === 'pointer';
                
                // 如果是纯文本 label (无 for, 无 input, 无 pointer)，通常不需要作为交互元素
                if (!hasFor && !hasInput && !isPointer) return;
            }
            
            // 5. 针对通用容器 (div, span 等通过 role/onclick 选中的) 的过滤
            const isNativeInteractive = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(el.tagName);
            if (!isNativeInteractive) {
                const style = window.getComputedStyle(el);
                // 如果没有 pointer 手型，且不是 role="button"/"link"，可能只是绑定了点击事件的容器
                if (style.cursor !== 'pointer' && el.getAttribute('role') !== 'button' && el.getAttribute('role') !== 'link') {
                    return;
                }
            }

            const uniqueId = `ds-ai-id-${counter++}`;
            el.setAttribute('data-ds-ai-id', uniqueId);

            const context = getElementContext(el);

            elements.push({
                id: uniqueId,
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                placeholder: el.placeholder || '',
                text: text.substring(0, 100),
                context: context,
                classList: Array.from(el.classList).join(' '),
                title: el.title || '',
                ariaLabel: el.ariaLabel || '',
                name: el.name || ''
            });
        });
        return elements;
    }

    function getPageContent(option) {
        // 获取页面HTML内容
        let html = document.documentElement.outerHTML;

        // 根据选项处理内容
        switch(option) {
            case 'no_css':
                // 移除CSS
                html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
                html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
                break;
            case 'no_js':
                // 移除JavaScript
                html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
                break;
            case 'no_js_css':
                // 移除JavaScript和CSS
                html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
                html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
                html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
                break;
            case 'full_html':
                // 原始上传，不处理
                break;
            default:
                // 默认不提交内容
                return '';
        }

        // 限制内容长度以避免超出API限制
        if (html.length > 100000) {
            html = html.substring(0, 100000) + '... [内容被截断]';
        }

        return html;
    }

    function buildPrompt(elements, goal, pageContent, contentUploadOption) {
        // 简化元素列表，只保留关键字段，减少token消耗
        const simplifiedElements = elements.map(el => ({
            id: el.id,
            tag: el.tag,
            text: el.text,
            context: el.context, // 包含上下文信息
            type: el.type,
            name: el.name,
            ariaLabel: el.ariaLabel,
            placeholder: el.placeholder
        }));
        
        const elementsJson = JSON.stringify(simplifiedElements, null, 2);

        let contentDescription = '';
        if (contentUploadOption === 'no_content') {
            contentDescription = '当前网页内容未提供。';
        } else {
            contentDescription = `当前网页内容：\n${pageContent}\n`;
        }

        return `
你是一个专业的网页自动化助手。你的任务是分析一个网页的多步骤操作目标，并将其分解为一系列精确的、可执行的操作指令。

**你的任务是:**
1.  分析用户的"多步骤操作目标"。
2.  查看提供的"页面可交互元素列表"。注意每个元素的 \`context\` 字段，它提供了元素所属的容器或标题信息（例如问卷的问题标题）。
3.  结合"当前网页内容"信息（如果提供）来更好地理解上下文。
4.  将目标分解为一个操作步骤序列。
5.  只返回一个JSON数组，数组中的每个对象代表一步操作。

**操作对象格式:**
- \`step\` (整数): 步骤编号，从1开始。
- \`action\` (字符串): 操作类型。必须是以下之一： \`"click"\`, \`"type"\`, \`"hover"\`, \`"click_text"\`, \`"scroll_to"\`。
- \`selector\` (字符串): 用于定位元素的CSS选择器。你必须使用为元素提供的 \`data-ds-ai-id\` 属性来构建，格式为 \`[data-ds-ai-id="..."]\`。
- \`text\` (字符串，可选): 当 \`action\` 为 \`"type"\` 时，提供需要输入的文本内容；当 \`action\` 为 \`"click_text"\` 时，提供要点击的文本内容。
- \`delay\` (数字，可选): 执行此步骤后等待的毫秒数。

**操作类型说明:**
- \`click\`: 点击元素。对于单选/复选框，请优先点击其关联的 label 或 input 元素。
- \`type\`: 向元素输入文本。
- \`hover\`: 悬停在元素上。
- \`click_text\`: 点击包含特定文本的元素。
- \`scroll_to\`: 滚动到元素位置。

**用户的多步骤操作目标:**
"""
${goal}
"""

**当前网页内容(默认留空):**
${contentDescription}

**页面上的可交互元素列表:**
${elementsJson}

请严格遵守以上规则，返回一个代表整个执行计划的JSON数组。
示例输出: [{"step": 1, "action": "click", "selector": "[data-ds-ai-id='...']"}, {"step": 2, "action": "type", "selector": "[data-ds-ai-id='...']", "text": "some text"}]
`;
    }

    function callAIProviderAPI(prompt, provider, apiKey) {
        return new Promise((resolve, reject) => {
            let url, model, maxTokens;

            if (provider === 'deepseek') {
                url = DEEPSEEK_API_URL;
                model = 'deepseek-chat';
                maxTokens = 8192; // DeepSeek API限制
            } else if (provider === 'zhipu') {
                url = ZHIPU_API_URL;
                model = 'glm-4.6';
                maxTokens = 65536; // 智谱AI支持更大的token
            } else {
                reject(new Error(`不支持的AI提供商: ${provider}`));
                return;
            }

            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                data: JSON.stringify({
                    model: model,
                    messages: [
                        { "role": "system", "content": "你是一个专业的网页自动化助手，严格按照指示返回JSON数组格式的数据。" },
                        { "role": "user", "content": prompt }
                    ],
                    stream: false,
                    temperature: 1,
                    max_tokens: maxTokens
                }),
                onload: response => {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const data = JSON.parse(response.responseText);
                            resolve(data);
                        } catch (e) {
                            reject(new Error(`解析API响应失败: ${e.message}`));
                        }
                    } else {
                        reject(new Error(`API 请求失败，状态码: ${response.status}. 响应: ${response.responseText}`));
                    }
                },
                onerror: error => reject(new Error(`网络请求错误: ${error.statusText || error}`)),
                ontimeout: () => reject(new Error('请求超时。'))
            });
        });
    }

    function parseResponse(response) {
        try {
            const content = response.choices[0].message.content;
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                console.error("AI响应中未找到JSON数组:", content);
                // 尝试解析不带外层括号的
                try {
                    return JSON.parse(content);
                } catch(e) {
                     console.error("直接解析也失败:", e);
                     return null;
                }
            }
            return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.error("解析AI响应失败:", e, "原始响应:", response.choices[0].message.content);
            return null;
        }
    }

    async function executeStepByStep(plan, delay) {
        for (let i = 0; i < plan.length; i++) {
            const step = plan[i];

            // 检查是否被外部停止
            if (!isExecuting) {
                logMessage("执行被用户中断。");
                return;
            }

            // 更新进度条
            updateProgress(i + 1, plan.length);

            // 显示当前步骤信息
            let element = null;
            if (step.action === 'click_text') {
                // 特殊处理点击文本的情况
                element = findElementByText(step.text);
            } else {
                element = document.querySelector(step.selector);
            }

            if (!element) {
                logMessage(`警告: 步骤 ${step.step}：无法找到选择器 "${step.selector}" 对应的元素。尝试重试...`);

                // 重试机制
                let retryCount = 0;
                while (retryCount < MAX_RETRY_ATTEMPTS && !element && isExecuting) {
                    retryCount++;
                    logMessage(`重试 ${retryCount}/${MAX_RETRY_ATTEMPTS}...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));

                    if (step.action === 'click_text') {
                        element = findElementByText(step.text);
                    } else {
                        element = document.querySelector(step.selector);
                    }
                }

                if (!element) {
                    throw new Error(`步骤 ${step.step}：经过 ${MAX_RETRY_ATTEMPTS} 次重试后仍然无法找到选择器 "${step.selector}" 对应的元素。`);
                } else {
                    logMessage(`在重试后成功找到元素`);
                }
            }

            // 清除上一步的高亮
            if (currentStepElement) currentStepElement.classList.remove(HIGHLIGHT_CLASS);

            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add(HIGHLIGHT_CLASS);
            currentStepElement = element;

            // 显示步骤信息
            showStepInfo(step, element, step.action, step.text);

            // 更新按钮文本以显示当前进度
            setButtonState(true, `执行中... ${i + 1}/${plan.length}`);

            // 等待元素滚动和高亮渲染完成
            await new Promise(resolve => setTimeout(resolve, 500));

            const elementInfo = `步骤 ${step.step}/${plan.length}: ${step.action}
标签: <${element.tagName.toLowerCase()}>
文本: "${(element.innerText || element.textContent || element.placeholder || '').substring(0, 60)}..."
${step.action === 'type' ? `\n输入内容: "${step.text}"` : ''}
${step.action === 'click_text' ? `\n点击文本: "${step.text}"` : ''}`;

            logMessage(`准备执行步骤 ${step.step}: ${step.action} - ${element.tagName.toLowerCase()}`);

            // 等待用户确认
            const confirmed = await new Promise(resolve => {
                if (confirm(`AI 建议执行以下操作，是否继续？\n\n${elementInfo}`)) {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });

            if (confirmed) {
                try {
                    if (step.action === 'click') {
                        element.click();
                        logMessage(`步骤 ${step.step}: 点击操作完成`);
                    }
                    // ########## START: MODIFIED BLOCK ##########
                    else if (step.action === 'type' && typeof step.text !== 'undefined') {
                        element.focus();

                        // This robust method works for modern frameworks like React
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value').set;
                        nativeInputValueSetter.call(element, step.text);

                        // Dispatch 'input' and 'change' events to notify the framework
                        element.dispatchEvent(new Event('input', { bubbles: true }));
                        element.dispatchEvent(new Event('change', { bubbles: true }));

                        logMessage(`步骤 ${step.step}: 输入 "${step.text}" 完成`);
                    }
                    // ########## END: MODIFIED BLOCK ##########
                    else if (step.action === 'hover') {
                        element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        logMessage(`步骤 ${step.step}: 悬停操作完成`);
                    } else if (step.action === 'click_text' && step.text) {
                        const textElement = findElementByText(step.text);
                        if (textElement) {
                            textElement.click();
                            logMessage(`步骤 ${step.step}: 点击文本 "${step.text}" 完成`);
                        } else {
                            throw new Error(`无法找到包含文本 "${step.text}" 的元素`);
                        }
                    } else if (step.action === 'scroll_to') {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        logMessage(`步骤 ${step.step}: 滚动到元素完成`);
                    }
                } catch (error) {
                    logMessage(`步骤 ${step.step} 执行失败: ${error.message}`);
                    throw error;
                }
            } else {
                // 用户取消某一步，则停止整个任务
                logMessage(`用户在第 ${step.step} 步取消了操作，任务已停止。`);
                GM_notification({
                    text: `用户在第 ${step.step} 步取消了操作`,
                    title: 'AI Automator',
                    timeout: 3000
                });
                return;
            }

            // 移除当前高亮，准备下一步
            element.classList.remove(HIGHLIGHT_CLASS);
            currentStepElement = null;
            clearStepInfo();

            // 在步骤之间稍作停顿，让页面有时间响应
            await new Promise(resolve => setTimeout(resolve, delay));

            // 如果步骤指定了额外延迟
            if (step.delay) {
                await new Promise(resolve => setTimeout(resolve, step.delay));
            }
        }

        logMessage(`所有 ${plan.length} 个步骤已执行完毕！`);
        GM_notification({
            text: `所有 ${plan.length} 个步骤已执行完毕！`,
            title: 'AI Automator',
            timeout: 5000
        });
    }

    // 根据文本查找元素的辅助函数
    function findElementByText(text) {
        if (!text) return null;
        const normalize = str => str.trim().toLowerCase().replace(/\s+/g, ' ');
        const target = normalize(text);

        // 优先查找交互元素
        const selectors = 'a, button, label, input, [role="button"], [role="link"], [onclick]';
        const elements = Array.from(document.querySelectorAll(selectors));

        // 1. 尝试精确匹配 (交互元素)
        let found = elements.find(el => el.offsetParent !== null && normalize(el.innerText || el.textContent || el.value || '') === target);
        if (found) return found;

        // 2. 尝试包含匹配 (交互元素)
        found = elements.find(el => el.offsetParent !== null && normalize(el.innerText || el.textContent || el.value || '').includes(target));
        if (found) return found;

        // 3. 扩大搜索范围到具有 cursor: pointer 的元素 (通常是自定义按钮)
        const potentialClickables = document.querySelectorAll('div, span, p, li, h1, h2, h3, h4, h5, h6');
        for (const el of potentialClickables) {
            if (el.offsetParent === null) continue;
            const elText = normalize(el.innerText || el.textContent || '');
            if (elText && elText.includes(target)) {
                const style = window.getComputedStyle(el);
                if (style.cursor === 'pointer') {
                    return el;
                }
            }
        }

        // 4. 最后的尝试：XPath 查找包含文本的任意可见元素
        try {
            // 查找包含文本的最小元素
            const xpath = `//*[contains(text(), "${text.replace(/"/g, '\\"')}") or contains(., "${text.replace(/"/g, '\\"')}")]`;
            const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

            let bestEl = null;
            let minLength = Infinity;

            for (let i = 0; i < result.snapshotLength; i++) {
                const el = result.snapshotItem(i);
                if (el.offsetParent !== null) {
                    const content = (el.innerText || el.textContent || '').trim();
                    if (content.length < minLength && content.length >= text.length) {
                        minLength = content.length;
                        bestEl = el;
                    }
                }
            }
            if (bestEl) return bestEl;
        } catch(e) {
            console.error("XPath search error:", e);
        }

        return null;
    }

})();
