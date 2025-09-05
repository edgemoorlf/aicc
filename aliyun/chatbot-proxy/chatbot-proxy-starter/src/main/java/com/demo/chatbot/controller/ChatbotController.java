package com.demo.chatbot.controller;


import com.alibaba.fastjson2.JSON;
import com.demo.chatbot.interfaces.ChatbotService;
import com.demo.chatbot.interfaces.SseCallback;
import com.demo.chatbot.interfaces.dto.AnswerDto;
import com.demo.chatbot.interfaces.request.AbortDialogueRequest;
import com.demo.chatbot.interfaces.request.BeginSessionRequest;
import com.demo.chatbot.interfaces.request.DialogueRequest;
import com.demo.chatbot.interfaces.request.EndSessionRequest;
import com.demo.chatbot.interfaces.response.BaseResponse;
import com.demo.chatbot.interfaces.response.GenericResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RequestMapping("/proxy/")
@RestController
@RequiredArgsConstructor
@Slf4j
public class ChatbotController {
    private final ChatbotService chatbotService;

    private void sendData(SseEmitter emitter, GenericResponse<AnswerDto> response) {
        try {
            emitter.send(response, MediaType.APPLICATION_JSON);
            if(response.getData().isStreamEnd()) {
                emitter.complete();
            }
        } catch (Exception e) {
            log.error(e.getMessage(), e);
            emitter.completeWithError(e);
        }
    }

    @RequestMapping(value = "/beginSession", method = RequestMethod.POST)
    public SseEmitter beginSession(@RequestBody BeginSessionRequest request) {
        log.info("Request is {}.", JSON.toJSONString(request));
        SseEmitter emitter = new SseEmitter();
        chatbotService.beginSession(request, response -> sendData(emitter, response));

        return emitter;
    }

    @RequestMapping(value = "/dialogue", method = RequestMethod.POST)
    public SseEmitter dialogue(@RequestBody DialogueRequest request) {
        log.info("Request is {}.", JSON.toJSONString(request));
        SseEmitter emitter = new SseEmitter();
        chatbotService.dialogue(request, response -> sendData(emitter, response));

        return emitter;
    }

    @RequestMapping(value = "/abortDialogue", method = RequestMethod.POST)
    public BaseResponse abortDialogue(@RequestBody AbortDialogueRequest request) {
        log.info("Request is {}.", JSON.toJSONString(request));
        return chatbotService.abortDialogue(request);
    }

    @RequestMapping(value = "/endSession", method = RequestMethod.POST)
    public BaseResponse endSession(@RequestBody EndSessionRequest request) {
        log.info("Request is {}.", JSON.toJSONString(request));
        return chatbotService.endSession(request);
    }

}
