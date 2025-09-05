package com.demo.chatbot.interfaces.dto;

import com.demo.chatbot.interfaces.constant.ControlType;
import jakarta.validation.constraints.NotEmpty;
import lombok.Builder;
import lombok.Data;

@Builder
@Data
public class TransferControlParams implements ControlParams {
    /**
     * 转接方式
     *
     * @see com.demo.chatbot.interfaces.constant.TransferType
     */
    @NotEmpty
    private String transferType;
    /**
     * 转接对象
     * <lo>
     * <li>当转给技能组时，传入技能组ID。</li>
     * <li>当转给坐席时，传入坐席ID，注意需自行控制转给一个空闲坐席。</li>
     * <li>当转给外呼号码时，传入真实手机号或者固话号码。</li>
     * </lo>
     */
    @NotEmpty
    private String transferee;
    /**
     * 当转给外呼号码时，需要传入自己的主叫号码，一般是自己从号线供应商处采购的固话号码。
     */
    private String transferor;

    @Override
    public ControlType getType() {
        return ControlType.Transfer;
    }
}
