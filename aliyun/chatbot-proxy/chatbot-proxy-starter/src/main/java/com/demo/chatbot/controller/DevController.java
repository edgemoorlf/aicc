package com.demo.chatbot.controller;


import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

@RequestMapping("/dev")
@RestController
@RequiredArgsConstructor
@Slf4j
public class DevController {
    private final CopyOnWriteArrayList<SseEmitter> emitters = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService schedule = Executors.newScheduledThreadPool(2);


    @PostConstruct
    public void init() {
        schedule.scheduleAtFixedRate(() -> {
            sendToClients("{\"message\": \"Hello!\"}");
        }, 100, 200, TimeUnit.MILLISECONDS);
    }

    @RequestMapping(value = "/hello", method = {RequestMethod.GET,RequestMethod.POST})
    public SseEmitter hello() {
        log.info("Start hello.");
        SseEmitter emitter = new SseEmitter(Long.MAX_VALUE);
        this.emitters.add(emitter);

        emitter.onCompletion(() -> this.emitters.remove(emitter));
        emitter.onTimeout(() -> this.emitters.remove(emitter));
        emitter.onError((e) -> this.emitters.remove(emitter));

        return emitter;
    }

    @RequestMapping(value = "/test", method = RequestMethod.GET)
    public String test() {
        return "test";
    }

    private void sendToClients(String data) {
        for (SseEmitter emitter : emitters) {
            try {
                emitter.send(data, MediaType.APPLICATION_JSON);
                try {
                    Thread.sleep(50L);
                } catch (InterruptedException ignore) {}
                emitter.send(data, MediaType.APPLICATION_JSON);
                emitter.complete();
            } catch (IOException e) {
                log.error(e.getMessage(),e);
            }
        }
    }

}
