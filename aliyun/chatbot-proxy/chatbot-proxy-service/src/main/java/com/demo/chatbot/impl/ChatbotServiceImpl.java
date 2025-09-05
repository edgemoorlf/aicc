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


@Service
public class ChatbotServiceImpl implements ChatbotService {
    private static final Logger log = LoggerFactory.getLogger(ChatbotServiceImpl.class);
    private final ScheduledExecutorService scheduledExecutorService = new ScheduledThreadPoolExecutor(100);
    // 记录对话轮次
    private final Map<String, List<Message>> sessions = new ConcurrentHashMap<>();
    private final Generation generation = new Generation();

    @Override
    public void beginSession(BeginSessionRequest beginSessionRequest, SseCallback<GenericResponse<AnswerDto>> sseCallback) {
        log.info("BeginSession request is {}.", JSON.toJSONString(beginSessionRequest));
        scheduledExecutorService.schedule(() -> {
            GenericResponse<AnswerDto> answer = new GenericResponse<>();
            answer.setRequestId(beginSessionRequest.getRequestId());

            // Extract customer info from vendorParams for collection context
            String customerName = "客户";
            String overdueAmount = "一万五千元"; 
            String overdueDays = "30天";
            
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
            
            // Generate professional collection greeting
            String collectionGreeting = String.format("您好%s，我是银行催收专员。关于您%s逾期%s的款项，需要和您协商还款事宜。", 
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
            } else if (value >= 1000) {
                double qian = value / 1000;
                if (qian == (int)qian) {
                    return String.format("%.0f千元", qian);
                } else {
                    return String.format("%.1f千元", qian);
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
        List<Message> messages = new ArrayList<>();
        
        // Build collection-specific prompt
        String collectionPrompt = String.format(
            "你是一名专业的银行催收专员，正在与客户进行债务协商对话。请用专业、礼貌但坚定的语气回应客户。" +
            "要求：1）使用专业的金融术语 2）保持礼貌和尊重 3）提供解决方案 4）回复要简洁，适合语音对话 5）不超过50字\n\n" +
            "客户说：%s\n\n" +
            "请回复：", 
            dialogueRequest.getUtterance()
        );
        
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
