"use client";

import { useState } from "react";
import {
  App as AntdApp,
  Button,
  Card,
  Empty,
  Form,
  Modal,
  Select,
  Space,
  TimePicker,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useCollection } from "@/store/hooks";
import { useSync } from "@/store/sync";
import {
  DAY_LABELS,
  LIFE_AREAS,
  LIFE_AREA_COLOR,
  maskToDays,
  toggleDay,
} from "@/lib/format";
import type { EnergyLevel, LifeArea } from "@/lib/types";

const { Title, Text } = Typography;

function DayToggle({ mask, onChange }: { mask: number; onChange: (m: number) => void }) {
  const active = maskToDays(mask);
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {DAY_LABELS.map((d, i) => (
        <Button
          key={i}
          size="small"
          type={active.includes(i) ? "primary" : "default"}
          onClick={() => onChange(toggleDay(mask, i))}
          style={{ width: 34, padding: 0 }}
        >
          {d}
        </Button>
      ))}
    </div>
  );
}

export function SchedulingTab() {
  const { message } = AntdApp.useApp();
  const regions = useCollection("blockRegion");
  const energy = useCollection("energyWindow");
  const create = useSync((s) => s.create);
  const remove = useSync((s) => s.remove);

  const [regionModal, setRegionModal] = useState(false);
  const [rCategory, setRCategory] = useState<LifeArea>("work");
  const [rMask, setRMask] = useState(62); // Mon–Fri
  const [rStart, setRStart] = useState("09:00");
  const [rEnd, setREnd] = useState("17:00");

  const [energyModal, setEnergyModal] = useState(false);
  const [eLevel, setELevel] = useState<EnergyLevel>("high");
  const [eMask, setEMask] = useState(62);
  const [eStart, setEStart] = useState("09:00");
  const [eEnd, setEEnd] = useState("12:00");

  function addRegion() {
    create("blockRegion", {
      category: rCategory,
      dayMask: rMask,
      start: rStart,
      end: rEnd,
      label: null,
    });
    setRegionModal(false);
    message.success("Region added");
  }

  function addEnergy() {
    create("energyWindow", {
      energyLevel: eLevel,
      dayMask: eMask,
      start: eStart,
      end: eEnd,
      source: "user",
    });
    setEnergyModal(false);
    message.success("Energy window added");
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>Time blocks</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Recurring regions steer where the scheduler places tasks
            </Text>
          </div>
          <Button icon={<PlusOutlined />} onClick={() => setRegionModal(true)}>Add</Button>
        </div>
        {regions.length === 0 ? (
          <Empty description="No time blocks yet" />
        ) : (
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {regions.map((r) => (
              <Card key={r.id} size="small" styles={{ body: { padding: "10px 14px" } }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: LIFE_AREA_COLOR[r.category],
                      }}
                    />
                    <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{r.category}</span>
                    <Text type="secondary">{r.start}–{r.end}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {maskToDays(r.dayMask).map((d) => DAY_LABELS[d]).join(" ")}
                    </Text>
                    {(r.category === "sleep" || r.category === "meal") && (
                      <Text type="secondary" style={{ fontSize: 11 }}>· protected</Text>
                    )}
                  </div>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove("blockRegion", r.id)} />
                </div>
              </Card>
            ))}
          </Space>
        )}
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>Energy windows</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              When you're sharp vs. low — high-demand tasks land in high-energy time
            </Text>
          </div>
          <Button icon={<PlusOutlined />} onClick={() => setEnergyModal(true)}>Add</Button>
        </div>
        {energy.length === 0 ? (
          <Empty description="Using sensible defaults" />
        ) : (
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            {energy.map((w) => (
              <Card key={w.id} size="small" styles={{ body: { padding: "10px 14px" } }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{w.energyLevel} energy</span>
                    <Text type="secondary">{w.start}–{w.end}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {maskToDays(w.dayMask).map((d) => DAY_LABELS[d]).join(" ")}
                    </Text>
                  </div>
                  <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove("energyWindow", w.id)} />
                </div>
              </Card>
            ))}
          </Space>
        )}
      </div>

      <Modal title="Add time block" open={regionModal} onCancel={() => setRegionModal(false)} onOk={addRegion} okText="Add">
        <Form layout="vertical">
          <Form.Item label="Category">
            <Select
              value={rCategory}
              onChange={setRCategory}
              options={LIFE_AREAS.map((a) => ({ label: a[0].toUpperCase() + a.slice(1), value: a }))}
            />
          </Form.Item>
          <Form.Item label="Days">
            <DayToggle mask={rMask} onChange={setRMask} />
          </Form.Item>
          <Space>
            <Form.Item label="Start">
              <TimePicker
                needConfirm={false}
                format="HH:mm"
                minuteStep={15}
                value={dayjs(rStart, "HH:mm")}
                onChange={(v) => v && setRStart(v.format("HH:mm"))}
              />
            </Form.Item>
            <Form.Item label="End">
              <TimePicker
                needConfirm={false}
                format="HH:mm"
                minuteStep={15}
                value={dayjs(rEnd, "HH:mm")}
                onChange={(v) => v && setREnd(v.format("HH:mm"))}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal title="Add energy window" open={energyModal} onCancel={() => setEnergyModal(false)} onOk={addEnergy} okText="Add">
        <Form layout="vertical">
          <Form.Item label="Energy level">
            <Select
              value={eLevel}
              onChange={setELevel}
              options={[
                { label: "High", value: "high" },
                { label: "Medium", value: "medium" },
                { label: "Low", value: "low" },
              ]}
            />
          </Form.Item>
          <Form.Item label="Days">
            <DayToggle mask={eMask} onChange={setEMask} />
          </Form.Item>
          <Space>
            <Form.Item label="Start">
              <TimePicker
                needConfirm={false}
                format="HH:mm"
                minuteStep={15}
                value={dayjs(eStart, "HH:mm")}
                onChange={(v) => v && setEStart(v.format("HH:mm"))}
              />
            </Form.Item>
            <Form.Item label="End">
              <TimePicker
                needConfirm={false}
                format="HH:mm"
                minuteStep={15}
                value={dayjs(eEnd, "HH:mm")}
                onChange={(v) => v && setEEnd(v.format("HH:mm"))}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
