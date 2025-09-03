/**
 * MetricsManager - 管理性能指标和统计数据
 * 包括延迟追踪、准确性评估、图表更新等
 */
class MetricsManager {
    constructor(debugLog) {
        this.debugLog = debugLog;
        
        // 指标数据
        this.metrics = {
            latency: [],
            accuracy: [],
            sessionStart: null,
            turnCount: 0,
            asrLatency: [],
            llmLatency: [],
            ttsLatency: [],
            endToEndLatency: []
        };
        
        // 延迟图表相关
        this.latencyChart = null;
        this.latencyChartData = [];
        this.maxLatencyDataPoints = 20;
        
        // 定时器
        this.metricsInterval = null;
    }

    initLatencyChart() {
        const canvas = document.getElementById('latency-chart');
        if (!canvas) return;
        
        this.latencyChart = {
            canvas: canvas,
            ctx: canvas.getContext('2d'),
            width: canvas.width,
            height: canvas.height
        };
        
        // 设置画布样式
        const ctx = this.latencyChart.ctx;
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, this.latencyChart.width, this.latencyChart.height);
        
        // 绘制初始网格和标签
        this.drawLatencyChartGrid();
        
        this.debugLog('延迟图表初始化完成');
    }

    drawLatencyChartGrid() {
        const { ctx, width, height } = this.latencyChart;
        
        // 清空画布
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        // 设置网格样式
        ctx.strokeStyle = '#e9ecef';
        ctx.lineWidth = 1;
        
        // 绘制水平网格线（延迟值）
        const maxLatency = 5000; // 最大显示5秒延迟
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const y = (height - 20) * i / gridLines + 10;
            ctx.beginPath();
            ctx.moveTo(30, y);
            ctx.lineTo(width - 10, y);
            ctx.stroke();
            
            // 绘制延迟标签
            const latencyValue = maxLatency - (maxLatency * i / gridLines);
            ctx.fillStyle = '#6c757d';
            ctx.font = '10px Arial';
            ctx.fillText(`${Math.round(latencyValue)}ms`, 2, y + 3);
        }
        
        // 绘制垂直网格线（时间轴）
        const timeGridLines = 4;
        for (let i = 0; i <= timeGridLines; i++) {
            const x = 30 + (width - 40) * i / timeGridLines;
            ctx.beginPath();
            ctx.moveTo(x, 10);
            ctx.lineTo(x, height - 10);
            ctx.stroke();
        }
        
        // 添加标题
        ctx.fillStyle = '#495057';
        ctx.font = '12px Arial';
        ctx.fillText('实时延迟 (ms)', 5, height - 2);
    }

    updateLatencyChart(newLatency) {
        if (!this.latencyChart) return;
        
        // 添加新的数据点
        this.latencyChartData.push({
            latency: newLatency,
            timestamp: Date.now()
        });
        
        // 保持最大数据点数量
        if (this.latencyChartData.length > this.maxLatencyDataPoints) {
            this.latencyChartData.shift();
        }
        
        // 重新绘制图表
        this.drawLatencyChart();
    }

    drawLatencyChart() {
        if (!this.latencyChart || this.latencyChartData.length === 0) return;
        
        const { ctx, width, height } = this.latencyChart;
        
        // 重绘网格
        this.drawLatencyChartGrid();
        
        // 准备绘制数据线
        const maxLatency = 5000;
        const chartWidth = width - 40;
        const chartHeight = height - 20;
        const dataPoints = this.latencyChartData.length;
        
        if (dataPoints < 2) return;
        
        // 绘制延迟曲线
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        for (let i = 0; i < dataPoints; i++) {
            const latency = Math.min(this.latencyChartData[i].latency, maxLatency);
            const x = 30 + (chartWidth * i / (this.maxLatencyDataPoints - 1));
            const y = 10 + chartHeight * (1 - latency / maxLatency);
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        ctx.stroke();
        
        // 绘制数据点
        ctx.fillStyle = '#007bff';
        for (let i = 0; i < dataPoints; i++) {
            const latency = Math.min(this.latencyChartData[i].latency, maxLatency);
            const x = 30 + (chartWidth * i / (this.maxLatencyDataPoints - 1));
            const y = 10 + chartHeight * (1 - latency / maxLatency);
            
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, 2 * Math.PI);
            ctx.fill();
        }
        
        // 显示最新延迟值
        if (dataPoints > 0) {
            const latestLatency = this.latencyChartData[dataPoints - 1].latency;
            ctx.fillStyle = '#28a745';
            ctx.font = 'bold 12px Arial';
            ctx.fillText(`${latestLatency}ms`, width - 60, 25);
        }
    }

    // 延迟指标更新方法
    updateLLMLatencyMetrics(llmLatency) {
        this.metrics.llmLatency.push({
            latency: llmLatency,
            timestamp: Date.now()
        });
        
        this.updateElementText('llm-latency', llmLatency + ' ms');
        this.debugLog(`LLM延迟更新: ${llmLatency}ms`);
    }

    updateTTSLatencyMetrics(ttsLatency) {
        this.metrics.ttsLatency.push({
            latency: ttsLatency,
            timestamp: Date.now()
        });
        
        this.updateElementText('tts-latency', ttsLatency + ' ms');
        this.debugLog(`TTS首块延迟: ${ttsLatency}ms (文本→首个音频)`);
    }

    updateASRLatencyMetrics(asrLatency) {
        this.metrics.asrLatency.push({
            latency: asrLatency,
            timestamp: Date.now()
        });
        
        this.updateElementText('asr-latency', asrLatency + ' ms');
        this.debugLog(`ASR处理延迟: ${asrLatency}ms (停止说话→识别完成)`);
    }

    updateServerLatencyMetrics(llmLatency, ttsLatency) {
        this.metrics.llmLatency.push({
            latency: llmLatency,
            timestamp: Date.now()
        });
        
        this.metrics.ttsLatency.push({
            latency: ttsLatency,
            timestamp: Date.now()
        });
        
        this.updateElementText('llm-latency', llmLatency + ' ms');
        this.updateElementText('tts-latency', ttsLatency + ' ms');
        
        this.debugLog(`服务器延迟记录 - LLM: ${llmLatency}ms, TTS: ${ttsLatency}ms`);
    }

    updateLatencyMetrics(latency) {
        this.metrics.latency.push({
            total: latency,
            timestamp: Date.now()
        });
        
        this.updateElementText('current-latency', latency + ' ms');
        
        // 设置等级
        let grade = 'poor';
        if (latency < 1000) grade = 'excellent';
        else if (latency < 2000) grade = 'good';
        else if (latency < 5000) grade = 'acceptable';
        
        const gradeElement = document.getElementById('latency-grade');
        if (gradeElement) {
            gradeElement.textContent = this.getGradeText(grade);
            gradeElement.className = `metric-grade ${grade}`;
        }
        
        // 更新平均延迟
        if (this.metrics.latency.length > 0) {
            const avgLatency = this.metrics.latency.reduce((sum, l) => sum + l.total, 0) / this.metrics.latency.length;
            this.updateElementText('avg-latency', Math.round(avgLatency) + ' ms');
        }
        
        // 更新延迟图表
        this.updateLatencyChart(latency);
    }

    getGradeText(grade) {
        const texts = {
            'excellent': '优秀',
            'good': '良好',
            'acceptable': '可接受',
            'poor': '较差'
        };
        return texts[grade] || grade;
    }

    updateSessionStats() {
        this.updateElementText('turn-count', this.metrics.turnCount.toString());
        
        if (this.metrics.sessionStart) {
            const duration = Date.now() - this.metrics.sessionStart;
            const minutes = Math.floor(duration / 60000);
            const seconds = Math.floor((duration % 60000) / 1000);
            this.updateElementText('session-duration', 
                `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
        }
        
        // 计算成功率 - 简化版本
        const successRate = this.metrics.turnCount > 0 ? 
            Math.min(100, (this.metrics.turnCount * 20)) : 0; // 每轮对话20%成功率
        this.updateElementText('success-rate', Math.round(successRate) + '%');
    }

    startMetricsUpdate() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        
        this.metricsInterval = setInterval(() => {
            this.updateSessionStats();
        }, 1000);
    }

    stopMetricsUpdate() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
            this.metricsInterval = null;
        }
    }

    // 准确性评估相关方法
    updateAccuracyMetrics(evaluation) {
        const speechAccuracy = evaluation.vocabulary_accuracy || 0;
        const responseQuality = evaluation.semantic_completeness || 0;
        const culturalScore = evaluation.terminology_accuracy || 0;
        
        this.updateElementText('speech-accuracy', speechAccuracy + '%');
        this.updateElementText('response-quality', responseQuality + '%');
        this.updateElementText('cultural-score', culturalScore + '%');
        
        // 保存评估历史
        if (!this.metrics.accuracy) {
            this.metrics.accuracy = [];
        }
        
        this.metrics.accuracy.push({
            overall: evaluation.overall_score || 0,
            vocabulary: evaluation.vocabulary_accuracy || 0,
            semantic: evaluation.semantic_completeness || 0,
            terminology: evaluation.terminology_accuracy || 0,
            comprehensibility: evaluation.comprehensibility || 0,
            grade: evaluation.grade || 'unknown',
            timestamp: Date.now()
        });
        
        this.updateAverageAccuracy();
    }

    updateAverageAccuracy() {
        if (!this.metrics.accuracy || this.metrics.accuracy.length === 0) return;
        
        const accuracyData = this.metrics.accuracy;
        const count = accuracyData.length;
        
        const avgVocabulary = Math.round(accuracyData.reduce((sum, item) => sum + item.vocabulary, 0) / count);
        const avgSemantic = Math.round(accuracyData.reduce((sum, item) => sum + item.semantic, 0) / count);
        const avgTerminology = Math.round(accuracyData.reduce((sum, item) => sum + item.terminology, 0) / count);
        
        this.updateElementText('speech-accuracy', avgVocabulary + '%');
        this.updateElementText('response-quality', avgSemantic + '%');
        this.updateElementText('cultural-score', avgTerminology + '%');
        
        this.updateAccuracyGrades(avgVocabulary, avgSemantic, avgTerminology);
    }

    updateAccuracyGrades(vocabulary, semantic, terminology) {
        const getGradeClass = (score) => {
            if (score >= 90) return 'excellent';
            if (score >= 75) return 'good';
            if (score >= 60) return 'acceptable';
            return 'poor';
        };
        
        const speechElement = document.getElementById('speech-accuracy');
        const responseElement = document.getElementById('response-quality');
        const culturalElement = document.getElementById('cultural-score');
        
        if (speechElement) {
            speechElement.className = `metric-value accuracy-${getGradeClass(vocabulary)}`;
        }
        if (responseElement) {
            responseElement.className = `metric-value accuracy-${getGradeClass(semantic)}`;
        }
        if (culturalElement) {
            culturalElement.className = `metric-value accuracy-${getGradeClass(terminology)}`;
        }
    }

    // 会话管理
    startSession() {
        this.metrics.sessionStart = Date.now();
        this.metrics.turnCount = 0;
        this.startMetricsUpdate();
    }

    endSession() {
        this.stopMetricsUpdate();
    }

    resetMetrics() {
        this.metrics = {
            latency: [],
            accuracy: [],
            sessionStart: null,
            turnCount: 0,
            asrLatency: [],
            llmLatency: [],
            ttsLatency: [],
            endToEndLatency: []
        };
        
        this.latencyChartData = [];
        
        // 重置UI显示
        const metricElements = [
            'current-latency', 'avg-latency', 'asr-latency', 'llm-latency', 'tts-latency',
            'turn-count', 'session-duration', 'success-rate',
            'speech-accuracy', 'response-quality', 'cultural-score'
        ];
        
        metricElements.forEach(id => {
            if (id.includes('latency')) {
                this.updateElementText(id, '-- ms');
            } else if (id.includes('accuracy') || id.includes('quality') || id.includes('score') || id.includes('rate')) {
                this.updateElementText(id, '--%');
            } else if (id === 'turn-count') {
                this.updateElementText(id, '0');
            } else if (id === 'session-duration') {
                this.updateElementText(id, '00:00');
            }
        });
        
        // 重置延迟等级
        const gradeElement = document.getElementById('latency-grade');
        if (gradeElement) {
            gradeElement.textContent = '--';
            gradeElement.className = 'metric-grade';
        }
        
        // 清除准确性等级样式
        const accuracyElements = ['speech-accuracy', 'response-quality', 'cultural-score'];
        accuracyElements.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.className = 'metric-value';
            }
        });
        
        // 重绘延迟图表
        if (this.latencyChart) {
            this.drawLatencyChartGrid();
        }
    }

    incrementTurnCount() {
        this.metrics.turnCount++;
    }

    // 工具方法
    updateElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    getMetrics() {
        return { ...this.metrics };
    }

    getLatencyStats() {
        if (this.metrics.latency.length === 0) return null;
        
        const latencies = this.metrics.latency.map(l => l.total);
        const avg = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
        const min = Math.min(...latencies);
        const max = Math.max(...latencies);
        
        return {
            average: Math.round(avg),
            minimum: min,
            maximum: max,
            count: latencies.length
        };
    }
}

// 导出类
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetricsManager;
} else if (typeof window !== 'undefined') {
    window.MetricsManager = MetricsManager;
}