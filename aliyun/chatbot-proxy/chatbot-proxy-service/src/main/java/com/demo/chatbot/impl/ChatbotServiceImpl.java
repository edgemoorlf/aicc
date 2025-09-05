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

            answer.setData(
                    AnswerDto.builder().sessionId(beginSessionRequest.getSessionId())
                            .streamId(beginSessionRequest.getStreamId())
                            .answer("欢迎来到三方大模型机器人。")
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
        } else if (dialogueRequest.getUtterance().contains("新闻")) {
            this.buildAnswerOnTurn2(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("收号")) {
            this.buildDtmfAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("转人工")) {
            this.buildTransferAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("挂机")) {
            this.buildHangupAnswer(dialogueRequest, sseCallback);
        } else if (dialogueRequest.getUtterance().contains("错误")) {
            this.buildErrorAnswer(dialogueRequest, sseCallback);
        } else {
            this.buildDefaultAnswer(dialogueRequest, sseCallback);
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
                    log.info("Receive complete event.");
                    GenericResponse<AnswerDto> answer = new GenericResponse<>();
                    answer.setRequestId(dialogueRequest.getRequestId());
                    AnswerDto answerDto = AnswerDto.builder()
                            .streamId(dialogueRequest.getStreamId())
                            .sessionId(dialogueRequest.getSessionId())
                            .updatedTime(System.currentTimeMillis())
                            .streamEnd(true)
                            .build();
                    answer.setData(answerDto);
                    sseCallback.onResponse(answer);
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
