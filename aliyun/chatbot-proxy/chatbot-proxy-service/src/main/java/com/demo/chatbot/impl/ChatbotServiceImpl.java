package com.demo.chatbot.impl;

import com.alibaba.dashscope.aigc.generation.Generation;
import com.alibaba.dashscope.aigc.generation.GenerationParam;
import com.alibaba.dashscope.aigc.generation.GenerationResult;
import com.alibaba.dashscope.common.Message;
import com.alibaba.dashscope.common.ResultCallback;
import com.alibaba.dashscope.common.Role;
import com.alibaba.fastjson2.JSON;
import com.demo.chatbot.interfaces.ChatbotService;
import com.demo.chatbot.interfaces.SseCallback;
import com.demo.chatbot.interfaces.constant.ExtraDataType;
import com.demo.chatbot.interfaces.constant.TransferType;
import com.demo.chatbot.interfaces.dto.*;
import com.demo.chatbot.interfaces.request.AbortDialogueRequest;
import com.demo.chatbot.interfaces.request.BeginSessionRequest;
import com.demo.chatbot.interfaces.request.DialogueRequest;
import com.demo.chatbot.interfaces.request.EndSessionRequest;
import com.demo.chatbot.interfaces.response.BaseResponse;
import com.demo.chatbot.interfaces.response.GenericResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.Random;


@Service
public class ChatbotServiceImpl implements ChatbotService {
    private static final Logger log = LoggerFactory.getLogger(ChatbotServiceImpl.class);
    private final ScheduledExecutorService scheduledExecutorService = new ScheduledThreadPoolExecutor(100);
    // 记录对话轮次
    private final Map<String, List<Message>> sessions = new ConcurrentHashMap<>();
    private final Generation generation = new Generation();
    private final Random random = new Random();
    // For inbound call demo, keep the same customer for the session
    private CustomerInfo customerIncall = DEMO_CUSTOMERS[1];

    // Customer data structure matching qwen/firefox implementation
    private static final CustomerInfo[] DEMO_CUSTOMERS = {
        new CustomerInfo("DEMO_001", "张伟", "+86-138-0013-8000", 15000, "2024-06-15", "overdue_payment", 67, 3, "medium"),
        new CustomerInfo("DEMO_002", "李娜", "+86-139-0013-9000", 8500, "2024-07-20", "payment_plan", 32, 1, "low"),
        new CustomerInfo("DEMO_003", "王强", "+86-137-0013-7000", 25000, "2024-05-10", "difficult_customer", 103, 7, "high"),
        new CustomerInfo("DEMO_004", "刘敏", "+86-136-0013-6000", 4200, "2024-07-28", "first_contact", 24, 0, "low")
    };
    
    // Customer information class
    public static class CustomerInfo {
        public final String id;
        public final String name;
        public final String phone;
        public final int balance;
        public final String lastPayment;
        public final String scenario;
        public final int daysOverdue;
        public final int previousContacts;
        public final String riskLevel;
        
        public CustomerInfo(String id, String name, String phone, int balance, String lastPayment, 
                           String scenario, int daysOverdue, int previousContacts, String riskLevel) {
            this.id = id;
            this.name = name;
            this.phone = phone;
            this.balance = balance;
            this.lastPayment = lastPayment;
            this.scenario = scenario;
            this.daysOverdue = daysOverdue;
            this.previousContacts = previousContacts;
            this.riskLevel = riskLevel;
        }
    }

    @Override
    public void beginSession(BeginSessionRequest beginSessionRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        log.info("BeginSession request is {}.", JSON.toJSONString(beginSessionRequest));
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(beginSessionRequest.getRequestId());

            // Random customer selection for inbound calls (POC)
            this.customerIncall = DEMO_CUSTOMERS[random.nextInt(DEMO_CUSTOMERS.length)];
            CustomerInfo selectedCustomer = this.customerIncall;
            log.info("随机选择客户: {} - 逾期本金: {}元, 逾期天数: {}天", 
                selectedCustomer.name, selectedCustomer.balance, selectedCustomer.daysOverdue);
            
            // Extract customer info from vendorParams or use randomly selected customer
            String customerName = selectedCustomer.name;
            String overdueAmount = formatChineseAmount(String.valueOf(selectedCustomer.balance)); 
            String overdueDays = selectedCustomer.daysOverdue + "天";
            
            if (beginSessionRequest.getVendorParams() != null) {
                Map<String, String> vendorParams = beginSessionRequest.getVendorParams();
                if (vendorParams.containsKey("customerName")) {
                    customerName = vendorParams.get("customerName");
                }
                if (vendorParams.containsKey("overdueAmount")) {
                    overdueAmount = formatChineseAmount(vendorParams.get("overdueAmount"));
                }
                if (vendorParams.containsKey("overdueDays")) {
                    overdueDays = vendorParams.get("overdueDays") + "天";
                }
            }
            
            // Generate professional collection greeting aligned with qwen-server-firefox.py
            String collectionGreeting = String.format("您好%s，我是平安银行信用卡中心的催收专员，工号888888。关于您%s逾期%s的欠款，已上报征信系统。请问您现在方便谈论还款安排吗？", 
                    customerName, overdueAmount, overdueDays);

            answer.setData(
                    AnswerDto.builder().sessionId(beginSessionRequest.getSessionId())
                            .streamId(beginSessionRequest.getStreamId())
                            .answer(collectionGreeting)
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 5, TimeUnit.MILLISECONDS);
    }

    @Override
    public void dialogue(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        log.info("Dialogue request is {}.", JSON.toJSONString(dialogueRequest));

        if (dialogueRequest.getExtras() != null && dialogueRequest.getExtras().size() == 1) {
            if (ExtraDataType.DTMF.name().equalsIgnoreCase(dialogueRequest.getExtras().get(0).get("dataType"))) {
                this.buildRepeatDtmfAnswer(dialogueRequest, sseCallback);
            } else if (ExtraDataType.Silence.name().equalsIgnoreCase(dialogueRequest.getExtras().get(0).get("dataType"))) {
                this.buildSilenceTimeoutAnswer(dialogueRequest, sseCallback);
            } else {
                this.buildDefaultAnswer(dialogueRequest, sseCallback);
            }
        } else if (dialogueRequest.getUtterance().contains("分期") || dialogueRequest.getUtterance().contains("还款计划")) {
            this.buildCollectionPaymentPlanAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("没钱") || dialogueRequest.getUtterance().contains("没有钱")) {
            this.buildCollectionNoMoneyAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("转人工")) {
            this.buildTransferAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("挂机")) {
            this.buildHangupAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("收号")) {
            this.buildDtmfAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("错误")) {
            this.buildErrorAnswer(dialogueRequest, sseCallback);
        } else {
            this.buildCollectionDefaultAnswer(dialogueRequest, sseCallback);
        }

    }

    @Override
    public BaseResponse abortDialogue(AbortDialogueRequest abortDialogueRequest) {
        log.info("Abort dialogue request is {}.", JSON.toJSONString(abortDialogueRequest));
        return new BaseResponse();
    }

    @Override
    public BaseResponse endSession(EndSessionRequest endSessionRequest) {
        log.info("End session request is {}.", JSON.toJSONString(endSessionRequest));
        return new BaseResponse();
    }

    /**
     * Build comprehensive collection prompt aligned with qwen-server-firefox.py
     * @param customerContext Customer information
     * @param conversationHistory Previous conversation (null for now)
     * @param customerUtterance What the customer just said
     * @return Complete collection prompt
     */
    private String buildCollectionPrompt(CustomerInfo customerContext, List<String> conversationHistory, String customerUtterance) {
        // Format Chinese amount like Firefox version
        String formattedAmount = formatChineseAmountForPrompt(customerContext.balance);
        
        // Build conversation history (simplified for now)
        String conversationText = "\n本次通话记录:\n(开始新对话)\n";
        
        String systemPrompt = String.format(
            "你是平安银行信用卡中心的专业催收专员，正在进行电话催收工作。\n\n" +
            "客户档案信息:\n" +
            "- 客户姓名: %s\n" +
            "- 逾期本金: %s\n" +
            "- 逾期天数: %d天\n" +
            "- 联系历史: %d次\n" +
            "- 风险等级: %s\n\n" +
            "%s\n" +
            "基于真实催收对话的标准话术:\n\n" +
            "【核实确认】\n" +
            "- \"我看您这边的话在[日期]还了一笔，还了[金额]\"\n" +
            "- \"当前的话还差[具体金额]，没有还够\"\n\n" +
            "【理解回应】\n" +
            "- \"也没有人说有钱不去还这个信用卡的，我可以理解\"\n" +
            "- \"可以理解，您的还款压力确实也是挺大的\"\n\n" +
            "【方案提供】\n" +
            "- \"当前的话还是属于一个内部协商\"\n" +
            "- \"银行这边可以帮您减免一部分息费\"\n" +
            "- \"还可以帮您去撤销这个余薪案件的\"\n\n" +
            "【专业用语】\n" +
            "- 使用\"您这边的话\"、\"当前的话\"、\"是吧\"等真实催收用语\n" +
            "- 使用\"内部协商\"、\"余薪案件\"、\"全额减免方案政策\"等专业术语\n\n" +
            "【重要原则】\n" +
            "1. 保持理解耐心的态度，避免强硬施压\n" +
            "2. 用具体数据建立可信度\n" +
            "3. 提供多种解决方案\n" +
            "4. 关注客户感受和实际困难\n" +
            "5. 使用银行专业术语增强权威性\n" +
            "6. 每一次回答尽量简练，不要超过4句话，最好在1-2句，避免长篇大论，确保客户能听懂\n" +
            "7. **严禁重复之前已经说过的内容** - 仔细查看通话记录，避免重复相同的话术、问题或信息\n" +
            "8. **根据对话进展调整策略** - 每次回复都要基于客户的最新回应，推进对话而不是重复\n\n" +
            "【防重复指南】\n" +
            "- 如果客户已经表达了某种态度或立场，不要重复询问相同的问题\n" +
            "- 如果已经提到过某种解决方案，不要再次重复介绍\n" +
            "- 根据客户的具体回应，选择新的角度或更深入的探讨\n" +
            "- 避免使用完全相同的开场白或结束语\n\n" +
            "语言要求:\n" +
            "- 使用大陆标准普通话，避免台湾用语\n" +
            "- 金额表达: 15000元说成\"一万五千元\"，不是\"十五千元\"\n" +
            "- 语气要专业、理解，体现人文关怀\n\n" +
            "客户说：%s\n\n" +
            "请以专业催收员的身份，针对客户的话语给出合适的回应，推进催收对话。",
            customerContext.name,
            formattedAmount,
            customerContext.daysOverdue,
            customerContext.previousContacts,
            getRiskLevelChinese(customerContext.riskLevel),
            conversationText,
            customerUtterance
        );
        
        return systemPrompt;
    }
    
    private String formatChineseAmountForPrompt(int amount) {
        if (amount >= 10000) {
            int wan = amount / 10000;
            int remainder = amount % 10000;
            if (remainder == 0) {
                return wan + "万元";
            } else {
                return wan + "万" + remainder + "元";
            }
        }
        return amount + "元";
    }
    
    private String getRiskLevelChinese(String riskLevel) {
        switch (riskLevel) {
            case "low": return "低风险";
            case "medium": return "中等风险";
            case "high": return "高风险";
            default: return "中等风险";
        }
    }
    
    private String formatChineseAmount(String amount) {
        if (amount == null || amount.trim().isEmpty()) {
            return "一万五千元";
        }
        
        // Remove any existing currency symbols and whitespace
        String cleanAmount = amount.replaceAll("[元,，\\s]", "");
        
        try {
            // Try to parse as number
            double value = Double.parseDouble(cleanAmount);
            
            // Convert to Chinese format for TTS readability
            if (value >= 10000) {
                double wan = value / 10000;
                if (wan == (int)wan) {
                    return String.format("%.0f万元", wan);
                } else {
                    return String.format("%.1f万元", wan);
                }
            } else {
                return String.format("%.0f元", value);
            }
        } catch (NumberFormatException e) {
            // If parsing fails, return the original or default
            return amount.contains("元") ? amount : amount + "元";
        }
    }

    private void buildCollectionPaymentPlanAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("理解您的情况。我们可以为您提供分期还款方案，比如分3期、6期或12期。请问您希望分几期还款？我们会根据您的实际情况制定合适的还款计划。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);
    }

    private void buildCollectionNoMoneyAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("我理解您目前的经济困难。我们银行也希望能帮助您解决问题。可以考虑先还一部分，哪怕是最低还款额，这样可以避免影响您的征信记录。您看这样行吗？")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);
    }

    private void buildCollectionDefaultAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        // Random customer selection for context (same as beginSession)
        CustomerInfo selectedCustomer = this.customerIncall;
        
        // Build comprehensive collection prompt aligned with qwen-server-firefox.py build_collection_prompt
        String collectionPrompt = buildCollectionPrompt(selectedCustomer, null, dialogueRequest.getUtterance());
        
        List<Message> messages = new ArrayList<>();
        messages.add(Message.builder()
                .content(collectionPrompt)
                .role(Role.USER.getValue())
                .build()
        );

        GenerationParam param = GenerationParam.builder()
                .model("qwen-plus")
                .apiKey("sk-89daa2f5ce954abba7770a87fa342db5")
                .resultFormat(GenerationParam.ResultFormat.TEXT)
                .messages(messages)
                .incrementalOutput(false)
                .build();

        try {
            log.info("Collection prompt sent to LLM: {}", collectionPrompt);
            generation.streamCall(param, new ResultCallback<GenerationResult>() {
                @Override
                public void onEvent(GenerationResult generationResult) {
                    log.info("Receive collection response: {}", JSON.toJSONString(generationResult));
                    GenericResponse<AnswerDto> answer = new GenericResponse<>();
                    answer.setRequestId(dialogueRequest.getRequestId());
                    List<String> controlParams = new ArrayList<>();
                    VoiceControlParams params = VoiceControlParams.builder()
                            .interruptible(true)
                            .build();
                    controlParams.add(JSON.toJSONString(params));
                    AnswerDto answerDto = AnswerDto.builder()
                            .streamId(dialogueRequest.getStreamId())
                            .sessionId(dialogueRequest.getSessionId())
                            .updatedTime(System.currentTimeMillis())
                            .answer(generationResult.getOutput().getText())
                            .streamEnd("stop".equals(generationResult.getOutput().getFinishReason()))
                            .controlParamsList(controlParams)
                            .build();
                    answer.setData(answerDto);
                    sseCallback.onResponse(answer);
                }

                @Override
                public void onComplete() {
                    log.info("Collection LLM response complete - stream already closed by onEvent");
                    // ✅ NO-OP: Stream was already completed by onEvent() when streamEnd=true
                    // This callback just logs completion, no additional SSE messages needed
                }

                @Override
                public void onError(Exception e) {
                    log.error(e.getMessage(), e);
                    GenericResponse<AnswerDto> answer = new GenericResponse<>();
                    answer.setRequestId(dialogueRequest.getRequestId());
                    answer.setHttpStatusCode(500);
                    answer.setCode("Error");
                    answer.setMessage(e.getMessage());
                    sseCallback.onResponse(answer);
                }
            });
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
    }

    private void buildAnswerOnTurn1(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：您好，")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 5, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：您好，今天北京天")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 7, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：您好，今天北京天气晴转多云，")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：您好，今天北京天气晴转多云，气温20摄氏度。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 20, TimeUnit.MILLISECONDS);
    }

    private void buildAnswerOnTurn2(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：北京早报，")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 5, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：北京早报，今天是2024年12月5号星期四，")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 7, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：北京早报，今天是2024年12月5号星期四，今天有以下几则新闻，")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：北京早报，今天是2024年12月5号星期四，今天有以下几则新闻，北京新开通2条地铁线。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(new ArrayList<>())
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 20, TimeUnit.MILLISECONDS);
    }

    private void buildDtmfAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            controlParamsList.add(
                    JSON.toJSONString(DtmfControlParams.builder()
                            .maxDigits(11)
                            .timeout(10)
                            .build())
            );
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：请输入11位手机号。")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：请输入11位手机号。请输入11位手机号。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 100, TimeUnit.MILLISECONDS);
    }

    private void buildRepeatDtmfAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            controlParamsList.add(
                    JSON.toJSONString(DtmfControlParams.builder()
                            .maxDigits(11)
                            .timeout(10)
                            .build())
            );
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：你输入的")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：请输入的号码是" + dialogueRequest.getExtras().get(0).get("dtmf") + "。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 100, TimeUnit.MILLISECONDS);
    }

    private void buildTransferAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            controlParamsList.add(
                    JSON.toJSONString(TransferControlParams.builder()
                            .transferType(TransferType.SkillGroup.name())
                            .transferee("C73ED769")
                            .build())
            );
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：正在帮你")
                            .streamEnd(false)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);

        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：正在帮你转接坐席。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 100, TimeUnit.MILLISECONDS);
    }

    private void buildHangupAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            controlParamsList.add(
                    JSON.toJSONString(HangUpControlParams.builder()
                            .delay(5)
                            .build())
            );
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：延迟5秒之后挂机。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 5, TimeUnit.MILLISECONDS);
    }

    private void buildSilenceTimeoutAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());

            List<String> controlParamsList = new ArrayList<>();
            answer.setData(
                    AnswerDto.builder().sessionId(dialogueRequest.getSessionId())
                            .streamId(dialogueRequest.getStreamId())
                            .answer("三方机器人说：刚刚触发静默超时。")
                            .streamEnd(true)
                            .updatedTime(System.currentTimeMillis())
                            .controlParamsList(controlParamsList)
                            .build()
            );

            sseCallback.onResponse(answer);
        }, 10, TimeUnit.MILLISECONDS);
    }

    private void buildDefaultAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        List<Message> messages = new ArrayList<>();
        messages.add(Message.builder()
                .content(dialogueRequest.getUtterance())
                .role(Role.USER.getValue())
                .build()
        );

        GenerationParam param = GenerationParam.builder()
                .model("qwen-plus")
                .apiKey("XXX")
                .resultFormat(GenerationParam.ResultFormat.TEXT)
                .messages(messages)
                .incrementalOutput(false)
                .build();

        try {
            log.info("Messages is {}.", JSON.toJSONString(messages));
            generation.streamCall(param, new ResultCallback<GenerationResult>() {
                @Override
                public void onEvent(GenerationResult generationResult) {
                    log.info("Receive event is {}.", JSON.toJSONString(generationResult));
                    GenericResponse<AnswerDto> answer = new GenericResponse<>();
                    answer.setRequestId(dialogueRequest.getRequestId());
                    List<String> controlParams = new ArrayList<>();
                    VoiceControlParams params = VoiceControlParams.builder()
                            .interruptible(true)
                            .build();
                    controlParams.add(JSON.toJSONString(params));
                    AnswerDto answerDto = AnswerDto.builder()
                            .streamId(dialogueRequest.getStreamId())
                            .sessionId(dialogueRequest.getSessionId())
                            .updatedTime(System.currentTimeMillis())
                            .answer(generationResult.getOutput().getText())
                            .streamEnd("stop".equals(generationResult.getOutput().getFinishReason()))
                            .controlParamsList(controlParams)
                            .build();
                    answer.setData(answerDto);
                    sseCallback.onResponse(answer);
                }

                @Override
                public void onComplete() {
                    log.info("DashScope stream complete - no additional SSE message needed");
                    // ✅ NO-OP: Stream already completed by onEvent() when streamEnd=true
                }

                @Override
                public void onError(Exception e) {
                    log.error(e.getMessage(), e);
                    GenericResponse<AnswerDto> answer = new GenericResponse<>();
                    answer.setRequestId(dialogueRequest.getRequestId());
                    answer.setHttpStatusCode(500);
                    answer.setCode("Error");
                    answer.setMessage(e.getMessage());
                    sseCallback.onResponse(answer);
                }
            });
        } catch (Exception e) {
            log.error(e.getMessage(), e);
        }
    }

    private void buildErrorAnswer(DialogueRequest dialogueRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(dialogueRequest.getRequestId());
            answer.setHttpStatusCode(500);
            answer.setCode("Exception");
            answer.setMessage("Http invoke fail.");
            sseCallback.onResponse(answer);
        }, 3, TimeUnit.MILLISECONDS);
    }

    public static void main(String[] args) {

        ChatbotServiceImpl chatbotService = new ChatbotServiceImpl();

        DialogueRequest request = new DialogueRequest();
        request.setRequestId(UUID.randomUUID().toString());
        request.setScriptId("s1");
        request.setInstanceId("i1");
        request.setSessionId(request.getRequestId());
        request.setStreamId(request.getStreamId());
        request.setUtterance("1+1等于几？");
        chatbotService.dialogue(request, new SseCallback<GenericResponse<AnswerDto>>() {
            @Override
            public void onResponse(GenericResponse<AnswerDto> response) {
                log.info(JSON.toJSONString(response));
            }
        });
    }
}
