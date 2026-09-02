from pptx import Presentation
from pptx.util import Inches, Pt

# Create presentation
prs = Presentation()
prs.slide_width = Inches(10)
prs.slide_height = Inches(7.5)

# Slide 1
slide1 = prs.slides.add_slide(prs.slide_layouts[1])
title = slide1.shapes.title
subtitle = slide1.placeholders[1]
title.text = "Introduction to Machine Learning"
subtitle.text = "Supervised Learning Basics"

# Slide 2
slide2 = prs.slides.add_slide(prs.slide_layouts[1])
title2 = slide2.shapes.title
subtitle2 = slide2.placeholders[1]
title2.text = "What is Machine Learning?"
subtitle2.text = "Machine learning is a subset of artificial intelligence that enables systems to learn and improve from experience without being explicitly programmed. It uses algorithms to find patterns in data and make predictions."

# Slide 3
slide3 = prs.slides.add_slide(prs.slide_layouts[1])
title3 = slide3.shapes.title
subtitle3 = slide3.placeholders[1]
title3.text = "Types of Machine Learning"
subtitle3.text = "1. Supervised Learning: Learning with labeled data (classification, regression)\n2. Unsupervised Learning: Learning patterns in unlabeled data (clustering)\n3. Reinforcement Learning: Learning through interaction and rewards"

# Save
prs.save('test_lecture.pptx')
print("✓ Test PowerPoint created: test_lecture.pptx")
