"""Generate realistic sample document images into static/samples/."""
import os
import textwrap

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "static", "samples")
os.makedirs(OUT, exist_ok=True)

FD = "/usr/share/fonts/truetype/dejavu/"
F_TITLE = ImageFont.truetype(FD + "DejaVuSans-Bold.ttf", 40)
F_H = ImageFont.truetype(FD + "DejaVuSans-Bold.ttf", 26)
F_B = ImageFont.truetype(FD + "DejaVuSans.ttf", 22)
F_BS = ImageFont.truetype(FD + "DejaVuSans.ttf", 19)
F_MONO = ImageFont.truetype(FD + "DejaVuSansMono.ttf", 20)
F_SMALL = ImageFont.truetype(FD + "DejaVuSans.ttf", 16)

W, H = 900, 1160
M = 70  # margin
INK = "#1a1a18"
PAPER = "#fbfaf5"


def doc():
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)
    # subtle paper texture lines
    for x in range(0, W, 4):
        d.line([(x, 0), (x, H)], fill="#faf9f3")
    return img, d


def wrap(d, text, x, y, font=F_BS, width=66, fill=INK, leading=30):
    for line in textwrap.wrap(text, width):
        d.text((x, y), line, font=font, fill=fill)
        y += leading
    return y + 6


def rule(d, y, w=1):
    d.line([(M, y), (W - M, y)], fill=INK, width=w)
    return y + 18


def kv(d, y, pairs, font=F_BS):
    x = M
    for k, v in pairs:
        d.text((x, y), f"{k}: ", font=F_SMALL, fill="#555")
        x += d.textlength(f"{k}: ", font=F_SMALL)
        d.text((x, y), v, font=font, fill=INK)
        x += d.textlength(v, font=font) + 40
    return y + 40


def table(d, y, rows, cols, widths, font=F_MONO):
    for i, row in enumerate(rows):
        x = M
        f = F_MONO if i else ImageFont.truetype(FD + "DejaVuSansMono-Bold.ttf", 20)
        for c, wpx in zip(row, widths):
            d.text((x, y), c, font=f, fill=INK)
            x += wpx
        y += 30
        if i == 0:
            d.line([(M, y - 4), (W - M, y - 4)], fill="#999")
    return y + 10


def stamp(d, text, x, y, color="#b03030"):
    f = ImageFont.truetype(FD + "DejaVuSans-Bold.ttf", 28)
    d.rounded_rectangle([x, y, x + d.textlength(text, font=f) + 24, y + 44],
                        radius=6, outline=color, width=3)
    d.text((x + 12, y + 7), text, font=f, fill=color)


# ---------------- 1. parking ticket ----------------
def parking_ticket():
    img, d = doc()
    d.rectangle([0, 0, W, 90], fill="#243b53")
    d.text((M, 26), "CITY OF MAPLEWOOD", font=F_TITLE, fill="white")
    d.text((M, 100), "PARKING VIOLATION NOTICE", font=F_H, fill="#b03030")
    y = 140
    y = kv(d, y, [("Notice No", "PM-8842107"), ("Issue Date", "09/12/2026")])
    y = kv(d, y, [("Plate", "XYZ-4412"), ("Location", "1200 block, Elm St")])
    y = rule(d, y)
    d.text((M, y), "Violation: Expired meter — Zone B (Ordinance 12.44)", font=F_B, fill=INK)
    y += 44
    y = table(d, y,
              [["Description", "Amount"],
               ["Base fine", "$45.00"],
               ["Administration fee", "$15.00"],
               ["Enforcement surcharge", "$25.00"],
               ["TOTAL DUE", "$85.00"]],
              None, [520, 200])
    y = rule(d, y)
    y = wrap(d, "Payment or contest must be received within 21 days of the issue date "
                "(by 10/03/2026). Unpaid fines increase to $170.00 after the deadline and "
                "may be sent to collections.", M, y)
    y = wrap(d, "To contest: submit Form PC-22 online or appear at the Violations Bureau, "
                "Room 114, City Hall, weekdays 8:30am-4:30pm.", M, y)
    stamp(d, "AMOUNT DUE: $85.00", M, H - 140)
    d.text((M, H - 70), "Pay online: maplewood.gov/pay  •  Ref: PM-8842107", font=F_SMALL, fill="#555")
    img.save(f"{OUT}/parking_ticket.png")


# ---------------- 2. medical bill ----------------
def medical_bill():
    img, d = doc()
    d.rectangle([0, 0, W, 90], fill="#0f5c63")
    d.text((M, 26), "RIVERSIDE GENERAL HOSPITAL", font=F_TITLE, fill="white")
    d.text((M, 100), "STATEMENT OF SERVICES", font=F_H, fill=INK)
    y = 140
    y = kv(d, y, [("Patient", "J. DOE"), ("Account", "RG-447821")])
    y = kv(d, y, [("Service Date", "08/29/2026"), ("Statement Date", "09/05/2026")])
    y = rule(d, y)
    y = table(d, y,
              [["Code", "Description", "Charge"],
               ["99284", "ER visit, level 4", "$1,120.00"],
               ["80053", "Compreh. metabolic panel", "$214.50"],
               ["71046", "Chest X-ray, 2 views", "$318.00"],
               ["96374", "IV push, single drug", "$96.73"],
               ["FAC01", "Facility fee", "$98.00"],
               ["", "TOTAL CHARGES", "$1,847.23"]],
              None, [90, 480, 190])
    y = rule(d, y)
    y = wrap(d, "Insurance adjustment: -$640.10   Insurance paid: -$522.00", M, y)
    d.text((M, y), "PATIENT RESPONSIBILITY: $685.13", font=F_H, fill="#b03030")
    y += 46
    y = wrap(d, "Payment due within 30 days of statement date (by 10/05/2026). "
                "Unpaid balances over 60 days may be referred to a collection agency. "
                "Ask about financial assistance: call 555-0142 or visit billing office, "
                "Building C, Floor 2.", M, y)
    stamp(d, "DUE: $685.13", M, H - 140)
    d.text((M, H - 70), "Questions? Billing Dept 555-0142  •  Mon-Fri 9-5", font=F_SMALL, fill="#555")
    img.save(f"{OUT}/medical_bill.png")


# ---------------- 3. rent increase notice ----------------
def rent_notice():
    img, d = doc()
    d.text((M, 40), "HARBOURVIEW PROPERTY MANAGEMENT LLC", font=F_H, fill=INK)
    d.text((M, 80), "88 Dockside Ave, Suite 4  •  Maplewood, ST 04110", font=F_SMALL, fill="#555")
    y = 130
    y = rule(d, y, 2)
    d.text((M, y), "NOTICE OF RENT ADJUSTMENT & LEASE RENEWAL", font=F_H, fill=INK)
    y += 48
    y = kv(d, y, [("Date", "09/14/2026"), ("Unit", "4B")])
    y = kv(d, y, [("Tenant", "A. RENTER"), ("Lease ends", "11/30/2026")])
    y = wrap(d, "Dear Tenant,", M, y)
    y = wrap(d, "Pursuant to Section 8.2 of your lease agreement, this letter serves as notice "
                "that effective 12/01/2026, the monthly rent for Unit 4B will increase from "
                "$1,250.00 to $1,395.00 (an 11.6% adjustment), reflecting current market rates "
                "and building operating costs.", M, y)
    y = wrap(d, "Your renewed lease will convert to a month-to-month term with a 60-day "
                "termination notice clause, and the security deposit will be topped up by "
                "$145.00 to match the new rent.", M, y)
    y = wrap(d, "If you wish to decline renewal and vacate, written notice must be received "
                "no later than 10/31/2026. Failure to respond by that date constitutes "
                "acceptance of all new terms.", M, y)
    y = wrap(d, "Note: per city ordinance 7.55, rent increases above 10% require 90 days "
                "advance notice and registration with the Rental Board.", M, y)
    stamp(d, "RESPOND BY 10/31/2026", M, H - 140)
    d.text((M, H - 70), "Signed: M. Castellanos, Property Manager", font=F_SMALL, fill="#555")
    img.save(f"{OUT}/rent_notice.png")


# ---------------- 4. insurance denial ----------------
def denial_letter():
    img, d = doc()
    d.rectangle([0, 0, W, 90], fill="#5a2d82")
    d.text((M, 26), "MERIDIAN HEALTH PLANS", font=F_TITLE, fill="white")
    d.text((M, 100), "EXPLANATION OF BENEFITS — CLAIM DECISION", font=F_H, fill=INK)
    y = 140
    y = kv(d, y, [("Member", "J. DOE"), ("Member ID", "MH-220481")])
    y = kv(d, y, [("Claim", "CL-990412"), ("Decision date", "09/08/2026")])
    y = rule(d, y)
    d.text((M, y), "Claim status: DENIED", font=F_H, fill="#b03030")
    y += 44
    y = wrap(d, "Service: MRI, lumbar spine (CPT 72148) ordered by Dr. Patel on 08/20/2026. "
                "Amount billed: $2,140.00.", M, y)
    y = wrap(d, "Reason for denial (code CO-97): The service was determined to be not "
                "medically necessary under plan guideline MCG-28. Conservative treatment "
                "(physical therapy for a minimum of 6 weeks) must be documented before "
                "advanced imaging is approved.", M, y)
    y = wrap(d, "You may appeal this decision. A written appeal with supporting medical "
                "records must be submitted within 180 days of this notice (by 03/07/2027). "
                "Your provider may appeal on your behalf.", M, y)
    y = wrap(d, "If the denial is upheld, the billed amount becomes your responsibility. "
                "Continued PT visits are covered at a $35 copay per session.", M, y)
    stamp(d, "CLAIM DENIED", M, H - 140)
    d.text((M, H - 70), "Appeals: PO Box 7701, Meridian, ST  •  Fax 555-0199", font=F_SMALL, fill="#555")
    img.save(f"{OUT}/denial_letter.png")


if __name__ == "__main__":
    parking_ticket()
    medical_bill()
    rent_notice()
    denial_letter()
    print("wrote 4 samples to", os.path.abspath(OUT))
